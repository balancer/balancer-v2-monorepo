import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { BasePoolEncoder, StablePoolEncoder, SwapKind } from '@balancer-labs/balancer-js';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { calculateInvariant } from '@balancer-labs/v2-helpers/src/models/pools/stable/math';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import Task, { TaskMode } from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { getSigner, impersonate, impersonateWhale } from '../../../src/signers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

describe('StablePool', function () {
  let owner: SignerWithAddress, whale: SignerWithAddress;
  let pool: Contract, factory: Contract, vault: Contract, usdc: Contract, dai: Contract, usdt: Contract;

  const task = new Task('20220608-stable-phase-I', TaskMode.TEST, getForkedNetwork(hre));

  const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f';
  const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';

  const tokens = [DAI, USDC];
  const amplificationParameter = bn(100);
  const swapFeePercentage = fp(0.01);
  const initialBalanceDAI = fp(1e6);
  const initialBalanceUSDC = fp(1e6).div(1e12); // 6 digits
  const initialBalances = [initialBalanceDAI, initialBalanceUSDC];
  let poolId: string;

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';

  before('run task', async () => {
    await task.run({ force: true });
    factory = await task.deployedInstance('StablePoolFactory');
  });

  before('load signers', async () => {
    owner = await getSigner();
    whale = await impersonateWhale(fp(100));
  });

  before('load vault and tokens', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.instanceAt('Vault', await factory.getVault());
    dai = await task.instanceAt('IERC20', DAI);
    usdc = await task.instanceAt('IERC20', USDC);
    usdt = await task.instanceAt('IERC20', USDT);
  });

  it('deploy a stable pool', async () => {
    const tx = await factory.create('SP', 'SPT', tokens, amplificationParameter, swapFeePercentage, owner.address);
    const event = expectEvent.inReceipt(await tx.wait(), 'PoolCreated');

    pool = await task.instanceAt('StablePool', event.args.pool);
    expect(await factory.isPoolFromFactory(pool.address)).to.be.true;

    poolId = pool.getPoolId();
    const [registeredAddress] = await vault.getPool(poolId);
    expect(registeredAddress).to.equal(pool.address);
  });

  it('can initialize a stable pool', async () => {
    await dai.connect(whale).approve(vault.address, MAX_UINT256);
    await usdc.connect(whale).approve(vault.address, MAX_UINT256);

    const poolId = await pool.getPoolId();
    const userData = StablePoolEncoder.joinInit(initialBalances);
    await vault.connect(whale).joinPool(poolId, whale.address, owner.address, {
      assets: tokens,
      maxAmountsIn: initialBalances,
      fromInternalBalance: false,
      userData,
    });

    const expectedInvariant = calculateInvariant([initialBalanceDAI, initialBalanceDAI], amplificationParameter);
    expectEqualWithError(await pool.balanceOf(owner.address), expectedInvariant, 0.001);
  });

  it('can swap in a stable pool', async () => {
    const amount = fp(500);
    await dai.connect(whale).transfer(owner.address, amount);
    await dai.connect(owner).approve(vault.address, amount);

    const poolId = await pool.getPoolId();
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

  it('converges when unbalanced', async () => {
    const tokens = [DAI, USDC, USDT];
    const amplificationParameter = bn(1);
    const swapFeePercentage = fp(0.01);
    const initialBalanceDAI = fp(0.00000001);
    const initialBalanceUSDC = fp(1200000000).div(1e12); // 6 digits
    const initialBalanceUSDT = fp(300).div(1e12); // 6 digits
    const initialBalances = [initialBalanceDAI, initialBalanceUSDC, initialBalanceUSDT];

    const tx = await factory.create('SP2', 'SPT2', tokens, amplificationParameter, swapFeePercentage, owner.address);
    const event = expectEvent.inReceipt(await tx.wait(), 'PoolCreated');

    const pool2 = await task.instanceAt('StablePool', event.args.pool);
    const poolId2 = await pool2.getPoolId();

    // Initialize the pool
    await dai.connect(whale).approve(vault.address, MAX_UINT256);
    await usdc.connect(whale).approve(vault.address, MAX_UINT256);
    await usdt.connect(whale).approve(vault.address, MAX_UINT256);

    const userData = StablePoolEncoder.joinInit(initialBalances);
    await vault.connect(whale).joinPool(poolId2, whale.address, owner.address, {
      assets: tokens,
      maxAmountsIn: initialBalances,
      fromInternalBalance: false,
      userData,
    });

    // It would have updated the invariant after initialization, so if this works, the invariant converges
  });

  context('permissioned functions', () => {
    let govMultisig: SignerWithAddress;

    before('impersonate the multi-sig and grant permissions', async () => {
      govMultisig = await impersonate(GOV_MULTISIG, fp(100));
      const authorizer = await new Task(
        '20210418-authorizer',
        TaskMode.READ_ONLY,
        getForkedNetwork(hre)
      ).deployedInstance('Authorizer');

      await authorizer.connect(govMultisig).grantRole(await actionId(factory, 'disable'), govMultisig.address);
      await authorizer.connect(govMultisig).grantRole(await actionId(pool, 'enterRecoveryMode'), govMultisig.address);
      await authorizer.connect(govMultisig).grantRole(await actionId(pool, 'exitRecoveryMode'), govMultisig.address);
      await authorizer.connect(govMultisig).grantRole(await actionId(pool, 'pause'), govMultisig.address);
      await authorizer.connect(govMultisig).grantRole(await actionId(pool, 'unpause'), govMultisig.address);
    });

    it('cannot perform a recovery exit until enabled', async () => {
      const bptBalance = await pool.balanceOf(whale.address);

      const userData = BasePoolEncoder.exitRecoveryMode(bptBalance);

      await expect(
        vault.connect(whale).exitPool(poolId, whale.address, owner.address, {
          assets: tokens,
          minAmountsOut: Array(tokens.length).fill(0),
          fromInternalBalance: false,
          userData,
        })
      ).to.be.revertedWith('BAL#438');
    });

    it('cannot perform a proportional exit when paused', async () => {
      await pool.connect(govMultisig).pause();
      const { paused } = await pool.getPausedState();

      expect(paused).to.be.true;

      const bptBalance = await pool.balanceOf(whale.address);
      const userData = StablePoolEncoder.exitExactBPTInForTokensOut(bptBalance);

      await expect(
        vault.connect(whale).exitPool(poolId, whale.address, owner.address, {
          assets: tokens,
          minAmountsOut: Array(tokens.length).fill(0),
          fromInternalBalance: false,
          userData,
        })
      ).to.be.revertedWith('BAL#402');
    });

    it('can perform a recovery mode exit when enabled (even while paused)', async () => {
      await pool.connect(govMultisig).enterRecoveryMode();
      const { paused } = await pool.getPausedState();

      expect(await pool.inRecoveryMode()).to.be.true;
      expect(paused).to.be.true;

      const bptBalance = await pool.balanceOf(owner.address);
      expect(bptBalance).to.gt(0);

      const vaultUSDCBalanceBeforeExit = await usdc.balanceOf(vault.address);
      const ownerUSDCBalanceBeforeExit = await usdc.balanceOf(owner.address);

      const userData = BasePoolEncoder.exitRecoveryMode(bptBalance);

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

    it('can disable the factory', async () => {
      await factory.connect(govMultisig).disable();

      // It should say disabled, and prevent creation
      expect(await factory.isDisabled()).to.be.true;
      await expect(
        factory.create('SP3', 'SPT3', tokens, amplificationParameter, swapFeePercentage, owner.address)
      ).to.be.revertedWith('BAL#211');
    });

    it('can exit pause and recovery modes', async () => {
      await pool.connect(govMultisig).exitRecoveryMode();
      await pool.connect(govMultisig).unpause();
      const { paused } = await pool.getPausedState();

      expect(await pool.inRecoveryMode()).to.be.false;
      expect(paused).to.be.false;
    });
  });
});
