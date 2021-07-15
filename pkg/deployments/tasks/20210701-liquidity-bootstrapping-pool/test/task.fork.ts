import hre from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';

import { SwapKind, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { calculateInvariant } from '@balancer-labs/v2-helpers/src/models/pools/weighted/math';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { advanceToTimestamp, currentTimestamp, DAY, MINUTE, MONTH } from '@balancer-labs/v2-helpers/src/time';

import Task from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { getSigner, impersonateWhale } from '../../../src/signers';

describe('LiquidityBootstrappingPoolFactory', function () {
  let owner: SignerWithAddress, whale: SignerWithAddress;
  let pool: Contract, factory: Contract, vault: Contract, usdc: Contract, dai: Contract;

  const task = Task.forTest('20210701-liquidity-bootstrapping-pool', getForkedNetwork(hre));

  const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f';
  const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

  const tokens = [DAI, USDC];
  const initialWeights = [fp(0.9), fp(0.1)];
  const swapFeePercentage = fp(0.01);
  const swapEnabledOnStart = true;

  const weightChangeDuration = MONTH;
  const endWeights = [fp(0.2), fp(0.8)];
  let endTime: BigNumber;

  const initialBalanceDAI = fp(9e6); // 9:1 DAI:USDC ratio
  const initialBalanceUSDC = fp(1e6).div(1e12); // 6 digits
  const initialBalances = [initialBalanceDAI, initialBalanceUSDC];

  before('run task', async () => {
    await task.run({ force: true });
    factory = await task.instanceAt('LiquidityBootstrappingPoolFactory', task.output().factory);
  });

  before('load signers', async () => {
    owner = await getSigner();
    whale = await impersonateWhale(fp(100));
  });

  before('load vault and tokens', async () => {
    const vaultTask = Task.forTest('20210418-vault', getForkedNetwork(hre));
    vault = await vaultTask.instanceAt('Vault', await factory.getVault());
    dai = await task.instanceAt('IERC20', DAI);
    usdc = await task.instanceAt('IERC20', USDC);
  });

  it('deploy a liquidity bootstrapping pool', async () => {
    const tx = await factory.create(
      'LBP',
      'LBPT',
      tokens,
      initialWeights,
      swapFeePercentage,
      owner.address,
      swapEnabledOnStart
    );
    const event = expectEvent.inReceipt(await tx.wait(), 'PoolCreated');

    pool = await task.instanceAt('LiquidityBootstrappingPool', event.args.pool);
    expect(await factory.isPoolFromFactory(pool.address)).to.be.true;

    const poolId = pool.getPoolId();
    const [registeredAddress] = await vault.getPool(poolId);
    expect(registeredAddress).to.equal(pool.address);
  });

  it('initialize a liquidity bootstrapping pool from the owner', async () => {
    // Only the owner can seed the pool, so we send them tokens from the whale
    await dai.connect(whale).transfer(owner.address, initialBalanceDAI);
    await usdc.connect(whale).transfer(owner.address, initialBalanceUSDC);

    // Approve the Vault to join
    await dai.connect(owner).approve(vault.address, MAX_UINT256);
    await usdc.connect(owner).approve(vault.address, MAX_UINT256);

    const poolId = await pool.getPoolId();
    const userData = WeightedPoolEncoder.joinInit(initialBalances);
    await vault.connect(owner).joinPool(poolId, owner.address, owner.address, {
      assets: tokens,
      maxAmountsIn: initialBalances,
      fromInternalBalance: false,
      userData,
    });

    const scaledBalances = [initialBalanceDAI, initialBalanceUSDC.mul(1e12)];
    // Initial BPT is the invariant multiplied by the number of tokens
    const expectedInvariant = calculateInvariant(scaledBalances, initialWeights).mul(tokens.length);

    expectEqualWithError(await pool.balanceOf(owner.address), expectedInvariant, 0.001);
  });

  it('can swap in a liquidity bootstrapping pool', async () => {
    const amount = fp(500); // Small relative to Pool balance - should have zero price impact
    await dai.connect(whale).approve(vault.address, amount);

    const poolId = await pool.getPoolId();

    const whaleUSDCBalanceBefore = await usdc.balanceOf(whale.address);

    await vault
      .connect(whale)
      .swap(
        { kind: SwapKind.GivenIn, poolId, assetIn: DAI, assetOut: USDC, amount, userData: '0x' },
        { sender: whale.address, recipient: whale.address, fromInternalBalance: false, toInternalBalance: false },
        0,
        MAX_UINT256
      );

    const whaleUSDCBalanceAfter = await usdc.balanceOf(whale.address);

    // Assert pool swap
    const expectedUSDC = amount.div(1e12);
    expectEqualWithError(whaleUSDCBalanceAfter.sub(whaleUSDCBalanceBefore), expectedUSDC, 0.1);
  });

  it('initial weights are correct', async () => {
    // Weights are not exact due to being stored in fewer bits
    expect(await pool.getNormalizedWeights()).to.equalWithError(initialWeights, 0.0001);
  });

  it('owner can start a gradual weight change', async () => {
    const startTime = (await currentTimestamp()).add(DAY);
    endTime = startTime.add(weightChangeDuration);

    const tx = await pool.connect(owner).updateWeightsGradually(startTime, endTime, endWeights);

    expectEvent.inReceipt(await tx.wait(), 'GradualWeightUpdateScheduled');

    const params = await pool.getGradualWeightUpdateParams();

    expect(params.startTime).to.equal(startTime);
    expect(params.endTime).to.equal(endTime);
    expect(params.endWeights).to.equalWithError(endWeights, 0.0001);
  });

  it('weights fully change once the time expires', async () => {
    await advanceToTimestamp(endTime.add(MINUTE));

    // Weights are not exact due to being stored in fewer bits
    expect(await pool.getNormalizedWeights()).to.equalWithError(endWeights, 0.0001);
  });
});
