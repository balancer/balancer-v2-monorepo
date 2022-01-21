import hre from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';

import { SwapKind, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { fp, bn } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { calculateInvariant } from '@balancer-labs/v2-helpers/src/models/pools/weighted/math';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { advanceToTimestamp, currentTimestamp, DAY, MINUTE, MONTH } from '@balancer-labs/v2-helpers/src/time';

import Task from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { getSigners, impersonateWhale } from '../../../src/signers';

describe('InvestmentPoolFactory', function () {
  let owner: SignerWithAddress, wallet: SignerWithAddress, whale: SignerWithAddress;
  let pool: Contract, factory: Contract, vault: Contract, usdc: Contract, dai: Contract;

  const task = Task.forTest('20210907-investment-pool', getForkedNetwork(hre));

  const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f';
  const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

  const tokens = [DAI, USDC];
  const initialWeights = [fp(0.9), fp(0.1)];
  const swapFeePercentage = fp(0.01);
  const managementSwapFeePercentage = fp(0.6);
  const swapEnabledOnStart = true;

  const weightChangeDuration = MONTH;
  const endWeights = [fp(0.2), fp(0.8)];
  let endTime: BigNumber;

  const initialBalanceDAI = fp(9e6); // 9:1 DAI:USDC ratio
  const initialBalanceUSDC = fp(1e6).div(1e12); // 6 digits
  const initialBalances = [initialBalanceDAI, initialBalanceUSDC];

  before('run task', async () => {
    await task.run({ force: true });
    factory = await task.deployedInstance('InvestmentPoolFactory');
  });

  before('load signers', async () => {
    [owner, wallet] = await getSigners();
    whale = await impersonateWhale(fp(100));
  });

  before('load vault and tokens', async () => {
    const vaultTask = Task.forTest('20210418-vault', getForkedNetwork(hre));
    vault = await vaultTask.instanceAt('Vault', await factory.getVault());
    dai = await task.instanceAt('IERC20', DAI);
    usdc = await task.instanceAt('IERC20', USDC);
  });

  it('deploy an investment pool', async () => {
    const tx = await factory.create(
      'Macro Hedge',
      'TCH-MH',
      tokens,
      initialWeights,
      swapFeePercentage,
      owner.address,
      swapEnabledOnStart,
      managementSwapFeePercentage
    );
    const event = expectEvent.inReceipt(await tx.wait(), 'PoolCreated');

    pool = await task.instanceAt('InvestmentPool', event.args.pool);
    expect(await factory.isPoolFromFactory(pool.address)).to.be.true;

    const poolId = pool.getPoolId();
    const [registeredAddress] = await vault.getPool(poolId);
    expect(registeredAddress).to.equal(pool.address);
  });

  it('initial weights are correct', async () => {
    // Weights are not exact due to being stored in fewer bits
    expect(await pool.getNormalizedWeights()).to.equalWithError(initialWeights, 0.0001);
  });

  it('initialize the pool', async () => {
    // Approve the Vault to join
    await dai.connect(whale).approve(vault.address, MAX_UINT256);
    await usdc.connect(whale).approve(vault.address, MAX_UINT256);

    const poolId = await pool.getPoolId();
    const userData = WeightedPoolEncoder.joinInit(initialBalances);
    await vault.connect(whale).joinPool(poolId, whale.address, whale.address, {
      assets: tokens,
      maxAmountsIn: initialBalances,
      fromInternalBalance: false,
      userData,
    });

    const scaledBalances = [initialBalanceDAI, initialBalanceUSDC.mul(1e12)];
    // Initial BPT is the invariant multiplied by the number of tokens
    const expectedInvariant = calculateInvariant(scaledBalances, initialWeights).mul(tokens.length);

    expectEqualWithError(await pool.balanceOf(whale.address), expectedInvariant, 0.001);
  });

  it('collected fees are initially zero', async () => {
    const fees = await pool.getCollectedManagementFees();

    expect(fees.tokens.map((x: string) => x.toLowerCase())).to.deep.equal(tokens);
    expect(fees.collectedFees).to.deep.equal(new Array(tokens.length).fill(bn(0)));
  });

  it('can swap in an investment pool', async () => {
    // Swap 500 DAI for 500 USDC - should have little price impact
    const amountInDAI = fp(500);

    const whaleUSDCBalanceBefore = await usdc.balanceOf(whale.address);

    await dai.connect(whale).approve(vault.address, amountInDAI);
    await vault.connect(whale).swap(
      {
        kind: SwapKind.GivenIn,
        poolId: await pool.getPoolId(),
        assetIn: DAI,
        assetOut: USDC,
        amount: amountInDAI,
        userData: '0x',
      },
      { sender: whale.address, recipient: whale.address, fromInternalBalance: false, toInternalBalance: false },
      0,
      MAX_UINT256
    );

    const whaleUSDCBalanceAfter = await usdc.balanceOf(whale.address);

    const expectedUSDC = amountInDAI.div(1e12); // USDC has 6 decimals and DAI 18, so there's a 12 decimal difference
    expectEqualWithError(whaleUSDCBalanceAfter.sub(whaleUSDCBalanceBefore), expectedUSDC, 0.1);
  });

  it('swap incurs management fees', async () => {
    const { collectedFees } = await pool.getCollectedManagementFees();

    // Swap Given in - fee should be on DAI (token 0)
    expect(collectedFees[0]).to.be.gt(0);
    expect(collectedFees[1]).to.equal(0);
  });

  it('owner can withdraw management fees', async () => {
    const DAIBalanceBefore = await dai.balanceOf(wallet.address);
    const USDCBalanceBefore = await usdc.balanceOf(wallet.address);

    await pool.connect(owner).withdrawCollectedManagementFees(wallet.address);

    // Fees should be in the wallet
    const DAIBalanceAfter = await dai.balanceOf(wallet.address);
    const USDCBalanceAfter = await usdc.balanceOf(wallet.address);

    // Only DAI fees were collected
    expect(DAIBalanceAfter).to.be.gt(DAIBalanceBefore);
    expect(USDCBalanceAfter).to.be.equal(USDCBalanceBefore);
  });

  it('owner can start a gradual weight change', async () => {
    const startTime = (await currentTimestamp()).add(DAY);
    endTime = startTime.add(weightChangeDuration);

    const tx = await pool.connect(owner).updateWeightsGradually(startTime, endTime, endWeights);
    expectEvent.inReceipt(await tx.wait(), 'GradualWeightUpdateScheduled');
  });

  it('weights fully change once the time expires', async () => {
    await advanceToTimestamp(endTime.add(MINUTE));

    // Weights are not exact due to being stored in fewer bits
    expect(await pool.getNormalizedWeights()).to.equalWithError(endWeights, 0.0001);
  });
});
