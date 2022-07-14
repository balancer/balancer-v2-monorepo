import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { BasePoolEncoder, StablePoolEncoder, SwapKind } from '@balancer-labs/balancer-js';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { calculateInvariant } from '@balancer-labs/v2-helpers/src/models/pools/stable-phantom/math';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import Task, { TaskMode } from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { getSigner, impersonate, impersonateWhale } from '../../../src/signers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

describe('StablePoolFactory', function () {
  let owner: SignerWithAddress, whale: SignerWithAddress, govMultisig: SignerWithAddress;
  let factory: Contract, vault: Contract, authorizer: Contract, usdc: Contract, dai: Contract, usdt: Contract;

  const task = new Task('20220609-stable-pool-v2', TaskMode.TEST, getForkedNetwork(hre));

  const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f';
  const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';

  const tokens = [DAI, USDC];
  const amplificationParameter = bn(100);
  const swapFeePercentage = fp(0.01);
  const initialBalanceDAI = fp(1e6);
  const initialBalanceUSDC = fp(1e6).div(1e12); // 6 digits
  const initialBalances = [initialBalanceDAI, initialBalanceUSDC];
  const upscaledInitialBalances = [initialBalanceDAI, initialBalanceUSDC.mul(1e12)];

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';

  before('run task', async () => {
    await task.run({ force: true });
    factory = await task.deployedInstance('StablePoolFactory');
  });

  before('load signers', async () => {
    owner = await getSigner();
    whale = await impersonateWhale(fp(100));

    govMultisig = await impersonate(GOV_MULTISIG, fp(100));
  });

  before('setup contracts', async () => {
    vault = await new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre)).deployedInstance('Vault');
    authorizer = await new Task('20210418-authorizer', TaskMode.READ_ONLY, getForkedNetwork(hre)).deployedInstance(
      'Authorizer'
    );

    dai = await task.instanceAt('IERC20', DAI);
    usdc = await task.instanceAt('IERC20', USDC);
    usdt = await task.instanceAt('IERC20', USDT);
  });

  describe('create and swap', () => {
    let pool: Contract;
    let poolId: string;

    it('deploy a stable pool', async () => {
      const tx = await factory.create('', '', tokens, amplificationParameter, swapFeePercentage, owner.address);
      const event = expectEvent.inReceipt(await tx.wait(), 'PoolCreated');

      pool = await task.instanceAt('StablePool', event.args.pool);
      expect(await factory.isPoolFromFactory(pool.address)).to.be.true;

      poolId = await pool.getPoolId();
      const [registeredAddress] = await vault.getPool(poolId);
      expect(registeredAddress).to.equal(pool.address);
    });

    it('initialize the pool', async () => {
      await dai.connect(whale).approve(vault.address, MAX_UINT256);
      await usdc.connect(whale).approve(vault.address, MAX_UINT256);

      const userData = StablePoolEncoder.joinInit(initialBalances);
      await vault.connect(whale).joinPool(poolId, whale.address, owner.address, {
        assets: tokens,
        maxAmountsIn: initialBalances,
        fromInternalBalance: false,
        userData,
      });

      const { balances } = await vault.getPoolTokens(poolId);
      expect(balances).to.deep.equal(initialBalances);

      const expectedInvariant = calculateInvariant(upscaledInitialBalances, amplificationParameter);
      expectEqualWithError(await pool.balanceOf(owner.address), expectedInvariant, 0.001);
    });

    it('swap in the pool', async () => {
      const amount = fp(500);
      await dai.connect(whale).transfer(owner.address, amount);
      await dai.connect(owner).approve(vault.address, amount);

      await vault
        .connect(owner)
        .swap(
          { kind: SwapKind.GivenIn, poolId, assetIn: DAI, assetOut: USDC, amount, userData: '0x' },
          { sender: owner.address, recipient: owner.address, fromInternalBalance: false, toInternalBalance: false },
          0,
          MAX_UINT256
        );

      // Assert pool swap
      const expectedUSDC = amount.div(1e12);
      expectEqualWithError(await dai.balanceOf(owner.address), 0, 0.0001);
      expectEqualWithError(await usdc.balanceOf(owner.address), expectedUSDC, 0.1);
    });
  });

  describe('extremely unbalanced pools', () => {
    it('the invariant converges', async () => {
      const unbalancedTokens = [DAI, USDC, USDT];
      const unbalancedBalanceDAI = fp(0.00000001);
      const unbalancedBalanceUSDC = fp(1200000000).div(1e12); // 6 digits
      const unbalancedBalanceUSDT = fp(300).div(1e12); // 6 digits
      const unbalancedBalances = [unbalancedBalanceDAI, unbalancedBalanceUSDC, unbalancedBalanceUSDT];
      const upscaledUnbalancedBalances = [
        unbalancedBalanceDAI,
        unbalancedBalanceUSDC.mul(1e12),
        unbalancedBalanceUSDT.mul(1e12),
      ];

      const tx = await factory.create(
        '',
        '',
        unbalancedTokens,
        amplificationParameter,
        swapFeePercentage,
        owner.address
      );
      const event = expectEvent.inReceipt(await tx.wait(), 'PoolCreated');

      const pool = await task.instanceAt('StablePool', event.args.pool);
      const poolId = await pool.getPoolId();

      // Initialize the pool
      await dai.connect(whale).approve(vault.address, MAX_UINT256);
      await usdc.connect(whale).approve(vault.address, MAX_UINT256);
      await usdt.connect(whale).approve(vault.address, MAX_UINT256);

      const userData = StablePoolEncoder.joinInit(unbalancedBalances);
      await vault.connect(whale).joinPool(poolId, whale.address, owner.address, {
        assets: unbalancedTokens,
        maxAmountsIn: unbalancedBalances,
        fromInternalBalance: false,
        userData,
      });

      // The fact that joining the pool did not revert is proof enough that the invariant converges, but we can also
      // explicitly check the last invariant.

      const expectedInvariant = calculateInvariant(upscaledUnbalancedBalances, amplificationParameter);
      const [lastInvariant] = await pool.getLastInvariant();
      expectEqualWithError(lastInvariant, expectedInvariant, 0.001);
    });
  });

  describe('recovery mode', () => {
    let pool: Contract;
    let poolId: string;

    before('deploy and initialize a stable pool', async () => {
      const tx = await factory.create('', '', tokens, amplificationParameter, swapFeePercentage, owner.address);
      const event = expectEvent.inReceipt(await tx.wait(), 'PoolCreated');

      pool = await task.instanceAt('StablePool', event.args.pool);
      poolId = await pool.getPoolId();

      await dai.connect(whale).approve(vault.address, MAX_UINT256);
      await usdc.connect(whale).approve(vault.address, MAX_UINT256);

      const userData = StablePoolEncoder.joinInit(initialBalances);
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

      const vaultUSDCBalanceBeforeExit = await usdc.balanceOf(vault.address);
      const ownerUSDCBalanceBeforeExit = await usdc.balanceOf(owner.address);

      const userData = BasePoolEncoder.recoveryModeExit(bptBalance);
      await vault.connect(owner).exitPool(poolId, owner.address, owner.address, {
        assets: tokens,
        minAmountsOut: Array(tokens.length).fill(0),
        fromInternalBalance: false,
        userData,
      });

      const remainingBalance = await pool.balanceOf(owner.address);
      expect(remainingBalance).to.equal(0);

      const vaultUSDCBalanceAfterExit = await usdc.balanceOf(vault.address);
      const ownerUSDCBalanceAfterExit = await usdc.balanceOf(owner.address);

      expect(vaultUSDCBalanceAfterExit).to.lt(vaultUSDCBalanceBeforeExit);
      expect(ownerUSDCBalanceAfterExit).to.gt(ownerUSDCBalanceBeforeExit);
    });
  });

  describe('factory disable', () => {
    it('the factory can be disabled', async () => {
      await authorizer.connect(govMultisig).grantRole(await actionId(factory, 'disable'), govMultisig.address);
      await factory.connect(govMultisig).disable();

      expect(await factory.isDisabled()).to.be.true;
      await expect(
        factory.create('', '', tokens, amplificationParameter, swapFeePercentage, owner.address)
      ).to.be.revertedWith('BAL#211');
    });
  });
});
