import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { BasePoolEncoder, SwapKind, toNormalizedWeights, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { getSigner, impersonate, getForkedNetwork, Task, TaskMode, describeForkTest } from '../../../src';

describeForkTest('WeightedPool V3', 'mainnet', 16577000, function () {
  let owner: SignerWithAddress,
    whale: SignerWithAddress,
    wstEthWhale: SignerWithAddress,
    govMultisig: SignerWithAddress;
  let factory: Contract,
    vault: Contract,
    authorizer: Contract,
    uni: Contract,
    comp: Contract,
    aave: Contract,
    wstEth: Contract,
    math: Contract;

  let task: Task;

  const COMP = '0xc00e94cb662c3520282e6f5717214004a7f26888';
  const UNI = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984';
  const AAVE = '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9';
  const WSTETH = '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0';

  const tokens = [UNI, AAVE, COMP];
  const initialBalanceCOMP = fp(1e4);
  const initialBalanceUNI = fp(1e5);
  const initialBalanceAAVE = fp(1e4);
  const initialBalances = [initialBalanceUNI, initialBalanceAAVE, initialBalanceCOMP];

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';
  const LARGE_TOKEN_HOLDER = '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503';
  const WSTETH_TOKEN_HOLDER = '0x4b5a787ac6921cdefc57d8823ebd4d211f8e0519';

  const NAME = 'Balancer Pool Token';
  const SYMBOL = 'BPT';
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const WEIGHTS = toNormalizedWeights([fp(20), fp(30), fp(50)]);

  const COMP_WSTETH_WEIGHTED_POOL_V2 = '0x496ff26B76b8d23bbc6cF1Df1eeE4a48795490F7';

  enum AttackType {
    DISABLE_RECOVERY_MODE,
    UPDATE_PROTOCOL_FEE_CACHE,
  }

  before('run task', async () => {
    task = new Task('20230206-weighted-pool-v3', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    factory = await task.deployedInstance('WeightedPoolFactory');
  });

  before('load signers', async () => {
    owner = await getSigner();
    whale = await impersonate(LARGE_TOKEN_HOLDER);
    wstEthWhale = await impersonate(WSTETH_TOKEN_HOLDER);

    govMultisig = await impersonate(GOV_MULTISIG);
  });

  before('setup contracts', async () => {
    vault = await new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre)).deployedInstance('Vault');
    authorizer = await new Task('20210418-authorizer', TaskMode.READ_ONLY, getForkedNetwork(hre)).deployedInstance(
      'Authorizer'
    );
    const managedPoolTask = await new Task('20221021-managed-pool', TaskMode.READ_ONLY, getForkedNetwork(hre));
    const managedPoolFactory = await managedPoolTask.deployedInstance('ManagedPoolFactory');
    math = await managedPoolTask.instanceAt('ExternalWeightedMath', await managedPoolFactory.getWeightedMath());

    comp = await task.instanceAt('IERC20', COMP);
    uni = await task.instanceAt('IERC20', UNI);
    aave = await task.instanceAt('IERC20', AAVE);
    wstEth = await task.instanceAt('IERC20', WSTETH);
  });

  async function createPool(): Promise<Contract> {
    const receipt = await (
      await factory.create(
        NAME,
        SYMBOL,
        tokens,
        WEIGHTS,
        [ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS],
        POOL_SWAP_FEE_PERCENTAGE,
        owner.address
      )
    ).wait();

    const event = expectEvent.inReceipt(receipt, 'PoolCreated');
    return task.instanceAt('WeightedPool', event.args.pool);
  }

  async function initPool(poolId: string) {
    await comp.connect(whale).approve(vault.address, MAX_UINT256);
    await uni.connect(whale).approve(vault.address, MAX_UINT256);
    await aave.connect(whale).approve(vault.address, MAX_UINT256);

    const userData = WeightedPoolEncoder.joinInit(initialBalances);
    await vault.connect(whale).joinPool(poolId, whale.address, owner.address, {
      assets: tokens,
      maxAmountsIn: initialBalances,
      fromInternalBalance: false,
      userData,
    });
  }

  describe('getters', () => {
    it('check factory version', async () => {
      const expectedFactoryVersion = {
        name: 'WeightedPoolFactory',
        version: 3,
        deployment: '20230206-weighted-pool-v3',
      };

      expect(await factory.version()).to.equal(JSON.stringify(expectedFactoryVersion));
    });

    it('check pool version', async () => {
      const pool = await createPool();

      const expectedPoolVersion = {
        name: 'WeightedPool',
        version: 3,
        deployment: '20230206-weighted-pool-v3',
      };

      expect(await pool.version()).to.equal(JSON.stringify(expectedPoolVersion));
    });
  });

  describe('create and swap', () => {
    let pool: Contract;
    let poolId: string;

    it('deploy a weighted pool', async () => {
      pool = await createPool();
      poolId = await pool.getPoolId();
      const [registeredAddress] = await vault.getPool(poolId);

      expect(registeredAddress).to.equal(pool.address);
    });

    it('initialize the pool', async () => {
      await initPool(poolId);

      const { balances } = await vault.getPoolTokens(poolId);
      expect(balances).to.deep.equal(initialBalances);
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

  describe('read-only reentrancy protection', () => {
    let pool: Contract;
    let poolId: string;
    let attacker: Contract;
    const attackerFunds = fp(1);

    sharedBeforeEach('deploy and fund attacker', async () => {
      attacker = await deploy('ReadOnlyReentrancyAttackerWP', { args: [vault.address] });
      await comp.connect(whale).transfer(attacker.address, attackerFunds);
      await uni.connect(whale).transfer(attacker.address, attackerFunds);
      await aave.connect(whale).transfer(attacker.address, attackerFunds);
      await wstEth.connect(wstEthWhale).transfer(attacker.address, attackerFunds);
    });

    context('when the target pool is not protected', () => {
      sharedBeforeEach('get affected pool instance', async () => {
        pool = await task.instanceAt('WeightedPool', COMP_WSTETH_WEIGHTED_POOL_V2);
        poolId = await pool.getPoolId();
      });

      itPerformsAttack(false);
    });

    context('when the target pool is protected', () => {
      sharedBeforeEach('deploy pool and attacker', async () => {
        pool = await createPool();
        poolId = await pool.getPoolId();

        await initPool(poolId);
      });

      itPerformsAttack(true);
    });

    function itPerformsAttack(expectRevert: boolean) {
      const action = expectRevert ? 'rejects' : 'does not reject';

      context('update protocol fee cache', () => {
        it(`${action} protocol fee cache attack`, async () => {
          await performAttack(AttackType.UPDATE_PROTOCOL_FEE_CACHE, expectRevert);
        });
      });

      context('disable recovery mode', () => {
        sharedBeforeEach('grant permissions to attacker', async () => {
          await authorizer
            .connect(govMultisig)
            .grantRole(await actionId(pool, 'disableRecoveryMode'), attacker.address);
        });

        it(`${action} disable recovery mode attack`, async () => {
          await performAttack(AttackType.DISABLE_RECOVERY_MODE, expectRevert);
        });
      });
    }

    async function performAttack(attackType: AttackType, expectRevert: boolean) {
      const attackTokens = (await vault.getPoolTokens(poolId)).tokens;

      const joinRequest = {
        assets: attackTokens,
        maxAmountsIn: Array(attackTokens.length).fill(MAX_UINT256),
        userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(Array(attackTokens.length).fill(attackerFunds), 0),
        fromInternalBalance: false,
      };

      const attack = attacker.startAttack(poolId, joinRequest, attackType, { value: 10 });
      if (expectRevert) {
        await expect(attack).to.be.revertedWith('BAL#420');
      } else {
        await expect(attack).to.not.be.reverted;
      }
    }
  });

  describe('recovery mode', () => {
    let pool: Contract;
    let poolId: string;

    before('deploy and initialize a weighted pool', async () => {
      pool = await createPool();
      poolId = await pool.getPoolId();

      await comp.connect(whale).approve(vault.address, MAX_UINT256);
      await uni.connect(whale).approve(vault.address, MAX_UINT256);
      await aave.connect(whale).approve(vault.address, MAX_UINT256);

      const userData = WeightedPoolEncoder.joinInit(initialBalances);
      await vault.connect(whale).joinPool(poolId, whale.address, owner.address, {
        assets: tokens,
        maxAmountsIn: initialBalances,
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
      await vault.connect(owner).exitPool(poolId, owner.address, owner.address, {
        assets: tokens,
        minAmountsOut: Array(tokens.length).fill(0),
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

      await expect(
        factory
          .connect(owner)
          .create(
            NAME,
            SYMBOL,
            tokens,
            WEIGHTS,
            [ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS],
            POOL_SWAP_FEE_PERCENTAGE,
            owner.address
          )
      ).to.be.revertedWith('BAL#211');
    });
  });
});
