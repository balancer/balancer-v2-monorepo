import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { SwapKind } from '@balancer-labs/balancer-js';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';

import Task from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { getSigner, impersonateWhale } from '../../../src/signers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

describe('PrimaryIssuePoolFactory', function () {
  let owner: SignerWithAddress, whale: SignerWithAddress;
  let pool: Contract, factory: Contract, vault: Contract, usdc: Contract, dai: Contract;

  const task = Task.forTest('20220415-primary-issue-pool', getForkedNetwork(hre));

  const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f';
  const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

  const minimumPrice = bn(100);
  const basePrice = bn(80);
  const maxAmountsIn = bn(1000);
  const swapFeePercentage = fp(0.01);

  before('run task', async () => {
    await task.run({ force: true });
    factory = await task.deployedInstance('PrimaryIssuePoolFactory');
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

  it('deploy a primary issue pool', async () => {
    const tx = await factory.create(dai, usdc, minimumPrice, basePrice, maxAmountsIn, swapFeePercentage, Date.now());
    const event = expectEvent.inReceipt(await tx.wait(), 'PoolCreated');

    pool = await task.instanceAt('PrimaryIssuePool', event.args.pool);
    expect(await factory.isPoolFromFactory(pool.address)).to.be.true;

    const poolId = pool.getPoolId();
    const [registeredAddress] = await vault.getPool(poolId);
    expect(registeredAddress).to.equal(pool.address);
  });

  it('can initialize a primary issue pool', async () => {
    await dai.connect(whale).approve(vault.address, MAX_UINT256);
    await usdc.connect(whale).approve(vault.address, MAX_UINT256);

    pool.initialize();

    expectEqualWithError(await pool.balanceOf(owner.address), maxAmountsIn, 0.001);
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

  it('can exit a primary issue pool', async () => {
    await dai.connect(whale).approve(vault.address, MAX_UINT256);
    await usdc.connect(whale).approve(vault.address, MAX_UINT256);

    pool.exit();
  });

});
