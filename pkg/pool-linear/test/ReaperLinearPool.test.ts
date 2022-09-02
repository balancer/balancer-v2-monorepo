import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import LinearPool from '@balancer-labs/v2-helpers/src/models/pools/linear/LinearPool';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { FundManagement, SingleSwap } from '@balancer-labs/balancer-js/src';

describe('ReaperLinearPool', function () {
  let bbrfDAI: LinearPool,
    bbrfUSDC: LinearPool,
    USDC: Token,
    rfUSDC: Token,
    DAI: Token,
    rfDAI: Token,
    WBTC: Token,
    rfWBTC: Token;
  let poolFactory: Contract;
  let trader: SignerWithAddress, lp: SignerWithAddress, owner: SignerWithAddress, deployer: SignerWithAddress;
  let usdcReaperVault: Contract, daiReaperVault: Contract, wbtcReaperVault: Contract;
  let vault: Vault;
  const usdcPricePerFullShare = fp(1.25);
  const daiPricePerFullShare = fp(2);
  const wbtcPricePerFullShare = fp(1.6);
  let funds: FundManagement;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);

  before('setup', async () => {
    [deployer, lp, trader, owner] = await ethers.getSigners();

    funds = {
      sender: lp.address,
      fromInternalBalance: false,
      toInternalBalance: false,
      recipient: lp.address,
    };
  });

  sharedBeforeEach('deploy tokens', async () => {
    USDC = await Token.create({ symbol: 'USDC', name: 'USDC', decimals: 6 });
    usdcReaperVault = await deploy('MockReaperVault', {
      args: [deployer.address, 'rfUSDC', 'rfUSDC', 18, USDC.address, usdcPricePerFullShare],
    });
    rfUSDC = await Token.deployedAt(usdcReaperVault.address);

    DAI = await Token.create({ symbol: 'DAI', name: 'DAI', decimals: 18 });
    daiReaperVault = await deploy('MockReaperVault', {
      args: [deployer.address, 'rfDAI', 'rfDAI', 18, DAI.address, daiPricePerFullShare],
    });
    rfDAI = await Token.deployedAt(daiReaperVault.address);

    WBTC = await Token.create({ symbol: 'WBTC', name: 'WBTC', decimals: 8 });
    wbtcReaperVault = await deploy('MockReaperVault', {
      args: [deployer.address, 'rfWBTC', 'rfWBTC', 18, WBTC.address, wbtcPricePerFullShare],
    });
    rfWBTC = await Token.deployedAt(wbtcReaperVault.address);

    const tokens = new TokenList([rfUSDC, DAI, rfDAI, rfWBTC]).sort();

    await tokens.mint({ to: [lp, trader], amount: fp(1_000_000) });

    await USDC.mint(lp, BigNumber.from(1_000_000e6));
    await USDC.mint(trader, BigNumber.from(1_000_000e6));
    await WBTC.mint(lp, BigNumber.from(1_000_000e8));
    await WBTC.mint(trader, BigNumber.from(1_000_000e8));
  });

  sharedBeforeEach('create vault an authorize tokens', async () => {
    vault = await Vault.create();

    for (const token of [USDC, rfUSDC, DAI, rfDAI]) {
      const tx = await token.instance.connect(lp).approve(vault.address, MAX_UINT256);
      await tx.wait();
    }
  });

  sharedBeforeEach('deploy pool factory', async () => {
    poolFactory = await deploy('ReaperLinearPoolFactory', {
      args: [vault.address],
    });
  });

  sharedBeforeEach('deploy and initialize bb-rf-DAI', async () => {
    const tx = await poolFactory.create(
      'Beets Reaper Boosted Pool (DAI)',
      'bb-rf-DAI',
      DAI.address,
      rfDAI.address,
      fp(1_000_000),
      POOL_SWAP_FEE_PERCENTAGE,
      owner.address
    );

    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolCreated');

    bbrfDAI = await LinearPool.deployedAt(event.args.pool);

    const data: SingleSwap = {
      poolId: bbrfDAI.poolId,
      kind: 0,
      assetIn: DAI.address,
      assetOut: bbrfDAI.address,
      amount: fp(100_000),
      userData: '0x',
    };

    const transaction = await vault.instance.connect(lp).swap(data, funds, BigNumber.from(0), MAX_UINT256);
    await transaction.wait();
  });

  sharedBeforeEach('deploy and initialize bb-rf-USDC', async () => {
    const tx = await poolFactory.create(
      'Beets Reaper Boosted Pool (USDC)',
      'bb-rf-USDC',
      USDC.address,
      rfUSDC.address,
      fp(1_000_000),
      POOL_SWAP_FEE_PERCENTAGE,
      owner.address
    );

    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolCreated');

    bbrfUSDC = await LinearPool.deployedAt(event.args.pool);

    const data: SingleSwap = {
      poolId: bbrfUSDC.poolId,
      kind: 0,
      assetIn: USDC.address,
      assetOut: bbrfUSDC.address,
      amount: BigNumber.from(100_000e6),
      userData: '0x',
    };

    const transaction = await vault.instance.connect(lp).swap(data, funds, BigNumber.from(0), MAX_UINT256);
    await transaction.wait();
  });

  sharedBeforeEach('deploy and initialize bb-rf-USDC', async () => {
    const tx = await poolFactory.create(
      'Beets Reaper Boosted Pool (USDC)',
      'bb-rf-USDC',
      USDC.address,
      rfUSDC.address,
      fp(1_000_000),
      POOL_SWAP_FEE_PERCENTAGE,
      owner.address
    );

    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolCreated');

    bbrfUSDC = await LinearPool.deployedAt(event.args.pool);

    const data: SingleSwap = {
      poolId: bbrfUSDC.poolId,
      kind: 0,
      assetIn: USDC.address,
      assetOut: bbrfUSDC.address,
      amount: BigNumber.from(100_000e6),
      userData: '0x',
    };

    const transaction = await vault.instance.connect(lp).swap(data, funds, BigNumber.from(0), MAX_UINT256);
    await transaction.wait();
  });

  it('should swap 0.000_000_000_000_800_000 rfUSDC to 1 USDC when the ppfs is 1.25e18', async () => {
    const data: SingleSwap = {
      poolId: bbrfUSDC.poolId,
      kind: 0,
      assetIn: rfUSDC.address,
      assetOut: USDC.address,
      amount: BigNumber.from('800000'),
      userData: '0x',
    };

    const balanceBefore = await USDC.balanceOf(lp.address);
    await vault.instance.connect(lp).swap(data, funds, BigNumber.from(0), MAX_UINT256);
    const balanceAfter = await USDC.balanceOf(lp.address);
    const amountReturned = balanceAfter.sub(balanceBefore).toString();

    expect(amountReturned.toString()).to.be.eq('1000000');
  });

  it('should swap 0.000_000_000_800_000_000 rfUSDC to 1,000 USDC when the ppfs is 1.25e18', async () => {
    const data: SingleSwap = {
      poolId: bbrfUSDC.poolId,
      kind: 0,
      assetIn: rfUSDC.address,
      assetOut: USDC.address,
      amount: BigNumber.from('800000000'),
      userData: '0x',
    };

    const balanceBefore = await USDC.balanceOf(lp.address);

    await vault.instance.connect(lp).swap(data, funds, BigNumber.from(0), MAX_UINT256);

    const balanceAfter = await USDC.balanceOf(lp.address);

    const amountReturned = balanceAfter.sub(balanceBefore).toString();

    expect(amountReturned.toString()).to.be.eq('1000000000');
  });

  it('should swap 1 rfDAI to 2 DAI when the pricePerFullShare is 2e18', async () => {
    const data: SingleSwap = {
      poolId: bbrfDAI.poolId,
      kind: 0,
      assetIn: rfDAI.address,
      assetOut: DAI.address,
      amount: fp(1),
      userData: '0x',
    };

    const balanceBefore = await DAI.balanceOf(lp.address);

    await vault.instance.connect(lp).swap(data, funds, BigNumber.from(0), MAX_UINT256);

    const balanceAfter = await DAI.balanceOf(lp.address);

    const amountReturned = balanceAfter.sub(balanceBefore).toString();

    expect(amountReturned.toString()).to.be.eq('2000000000000000000');
  });
});