import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { BasePoolEncoder, SwapKind, toNormalizedWeights, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { ManagedPoolParams } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import { ProtocolFee } from '@balancer-labs/v2-helpers/src/models/vault/types';

import { getSigner, impersonate, getForkedNetwork, Task, TaskMode, describeForkTest } from '../../../../src';

describeForkTest('ManagedPoolFactory', 'mainnet', 15634000, function () {
  let owner: SignerWithAddress, whale: SignerWithAddress, govMultisig: SignerWithAddress;
  let factory: Contract,
    vault: Contract,
    authorizer: Contract,
    uni: Contract,
    comp: Contract,
    aave: Contract,
    math: Contract;

  let task: Task;

  const COMP = '0xc00e94cb662c3520282e6f5717214004a7f26888';
  const UNI = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984';
  const AAVE = '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9';

  const tokens = [UNI, AAVE, COMP];
  const initialBalanceCOMP = fp(1e4);
  const initialBalanceUNI = fp(1e5);
  const initialBalanceAAVE = fp(1e4);
  const initialBalances = [initialBalanceUNI, initialBalanceAAVE, initialBalanceCOMP];

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';
  const LARGE_TOKEN_HOLDER = '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503';

  const NAME = 'Balancer Pool Token';
  const SYMBOL = 'BPT';
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const POOL_MANAGEMENT_AUM_FEE_PERCENTAGE = fp(0.01);
  const WEIGHTS = toNormalizedWeights([fp(20), fp(30), fp(50)]);

  before('run task', async () => {
    task = new Task('20221021-managed-pool', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    factory = await task.deployedInstance('ManagedPoolFactory');
    math = await task.instanceAt('ExternalWeightedMath', await factory.getWeightedMath());
  });

  before('load signers', async () => {
    owner = await getSigner();
    whale = await impersonate(LARGE_TOKEN_HOLDER);

    govMultisig = await impersonate(GOV_MULTISIG);
  });

  before('setup contracts', async () => {
    vault = await new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre)).deployedInstance('Vault');
    authorizer = await new Task('20210418-authorizer', TaskMode.READ_ONLY, getForkedNetwork(hre)).deployedInstance(
      'Authorizer'
    );

    comp = await task.instanceAt('IERC20', COMP);
    uni = await task.instanceAt('IERC20', UNI);
    aave = await task.instanceAt('IERC20', AAVE);
  });

  async function createPool(swapEnabled = true, mustAllowlistLPs = false): Promise<Contract> {
    const assetManagers: string[] = Array(tokens.length).fill(ZERO_ADDRESS);
    assetManagers[0] = owner.address;

    const newPoolParams: ManagedPoolParams = {
      name: NAME,
      symbol: SYMBOL,
      tokens: tokens,
      normalizedWeights: WEIGHTS,
      assetManagers: assetManagers,
      swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
      swapEnabledOnStart: swapEnabled,
      mustAllowlistLPs: mustAllowlistLPs,
      managementAumFeePercentage: POOL_MANAGEMENT_AUM_FEE_PERCENTAGE,
      aumFeeId: ProtocolFee.AUM,
    };

    const receipt = await (await factory.connect(owner).create(newPoolParams, owner.address)).wait();

    const event = expectEvent.inReceipt(receipt, 'PoolCreated');
    return task.instanceAt('ManagedPool', event.args.pool);
  }

  describe('create and swap', () => {
    let pool: Contract;
    let poolId: string;

    it('deploy a managed pool', async () => {
      pool = await createPool();
      poolId = await pool.getPoolId();
      const [registeredAddress] = await vault.getPool(poolId);

      expect(registeredAddress).to.equal(pool.address);
    });

    it('initialize the pool', async () => {
      await comp.connect(whale).approve(vault.address, MAX_UINT256);
      await uni.connect(whale).approve(vault.address, MAX_UINT256);
      await aave.connect(whale).approve(vault.address, MAX_UINT256);

      const userData = WeightedPoolEncoder.joinInit(initialBalances);
      // This is a composable pool, so assets array has to contain BPT.
      await vault.connect(whale).joinPool(poolId, whale.address, owner.address, {
        assets: [pool.address, ...tokens],
        maxAmountsIn: [MAX_UINT256, ...initialBalances],
        fromInternalBalance: false,
        userData,
      });

      const { balances } = await vault.getPoolTokens(poolId);
      const totalSupply = await pool.totalSupply();
      const ownerBpt = await pool.balanceOf(owner.address);
      const minBpt = await pool.balanceOf(ZERO_ADDRESS);

      expect(balances).to.deep.equal([totalSupply.sub(ownerBpt).sub(minBpt), ...initialBalances]);
    });

    it('swap in the pool', async () => {
      const amount = fp(500);
      await comp.connect(whale).transfer(owner.address, amount);
      await comp.connect(owner).approve(vault.address, amount);

      await vault
        .connect(owner)
        .swap(
          { kind: SwapKind.GivenIn, poolId, assetIn: COMP, assetOut: UNI, amount, userData: '0x' },
          { sender: owner.address, recipient: owner.address, fromInternalBalance: false, toInternalBalance: false },
          0,
          MAX_UINT256
        );

      // Assert pool swap
      const expectedUNI = await math.calcOutGivenIn(
        initialBalanceCOMP,
        WEIGHTS[tokens.indexOf(COMP)],
        initialBalanceUNI,
        WEIGHTS[tokens.indexOf(UNI)],
        amount
      );
      expectEqualWithError(await comp.balanceOf(owner.address), 0, 0.0001);
      expectEqualWithError(await uni.balanceOf(owner.address), expectedUNI, 0.1);
    });
  });

  describe('recovery mode', () => {
    let pool: Contract;
    let poolId: string;

    before('deploy and initialize a stable pool', async () => {
      pool = await createPool();
      poolId = await pool.getPoolId();

      await comp.connect(whale).approve(vault.address, MAX_UINT256);
      await uni.connect(whale).approve(vault.address, MAX_UINT256);
      await aave.connect(whale).approve(vault.address, MAX_UINT256);

      const userData = WeightedPoolEncoder.joinInit(initialBalances);
      // This is a composable pool, so assets array has to contain BPT.
      await vault.connect(whale).joinPool(poolId, whale.address, owner.address, {
        assets: [pool.address, ...tokens],
        maxAmountsIn: [MAX_UINT256, ...initialBalances],
        fromInternalBalance: false,
        userData,
      });
    });

    before('enter recovery mode', async () => {
      await authorizer.connect(govMultisig).grantRole(await actionId(pool, 'enableRecoveryMode'), govMultisig.address);
      await pool.connect(govMultisig).enableRecoveryMode();
      expect(await pool.inRecoveryMode()).to.be.true;
    });

    it('can exit via recovery mode', async () => {
      const bptBalance = await pool.balanceOf(owner.address);
      expect(bptBalance).to.gt(0);

      const vaultUNIBalanceBeforeExit = await uni.balanceOf(vault.address);
      const ownerUNIBalanceBeforeExit = await uni.balanceOf(owner.address);

      const userData = BasePoolEncoder.recoveryModeExit(bptBalance);
      const tokensWithBpt = [pool.address, ...tokens];
      await vault.connect(owner).exitPool(poolId, owner.address, owner.address, {
        assets: tokensWithBpt,
        minAmountsOut: Array(tokensWithBpt.length).fill(0),
        fromInternalBalance: false,
        userData,
      });

      const remainingBalance = await pool.balanceOf(owner.address);
      expect(remainingBalance).to.equal(0);

      const vaultUNIBalanceAfterExit = await uni.balanceOf(vault.address);
      const ownerUNIBalanceAfterExit = await uni.balanceOf(owner.address);

      expect(vaultUNIBalanceAfterExit).to.lt(vaultUNIBalanceBeforeExit);
      expect(ownerUNIBalanceAfterExit).to.gt(ownerUNIBalanceBeforeExit);
    });
  });

  describe('factory disable', () => {
    it('the factory can be disabled', async () => {
      await authorizer.connect(govMultisig).grantRole(await actionId(factory, 'disable'), govMultisig.address);
      await factory.connect(govMultisig).disable();

      expect(await factory.isDisabled()).to.be.true;

      const newPoolParams: ManagedPoolParams = {
        name: NAME,
        symbol: SYMBOL,
        tokens: tokens,
        normalizedWeights: WEIGHTS,
        assetManagers: Array(tokens.length).fill(ZERO_ADDRESS),
        swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
        swapEnabledOnStart: true,
        mustAllowlistLPs: true,
        managementAumFeePercentage: POOL_MANAGEMENT_AUM_FEE_PERCENTAGE,
        aumFeeId: ProtocolFee.AUM,
      };
      await expect(factory.connect(owner).create(newPoolParams, owner.address)).to.be.revertedWith('BAL#211');
    });
  });
});
