import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { encodeJoin } from '@balancer-labs/v2-helpers/src/models/pools/mockPool';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { GeneralPool } from '@balancer-labs/v2-helpers/src/models/vault/pools';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';

const OVER_INVESTMENT_REVERT_REASON = 'investment amount exceeds target';

describe('Single Pool Asset Manager', function () {
  let tokens: TokenList, vault: Contract, assetManager: Contract;
  let admin: SignerWithAddress, lp: SignerWithAddress, other: SignerWithAddress;
  let poolId: string;
  const tokenInitialBalance = bn(200e18);
  const amount = bn(100e18);

  before('deploy base contracts', async () => {
    [admin, lp, other] = await ethers.getSigners();
  });

  sharedBeforeEach('set up asset manager', async () => {
    // Deploy tokens and vault
    tokens = await TokenList.create(['DAI', 'MKR'], { sorted: true });
    const vaultHelper = await Vault.create({ admin });
    vault = vaultHelper.instance;

    // deploy pool and add liquidity
    const pool = await deploy('v2-vault/MockPool', { args: [vault.address, GeneralPool] });
    poolId = await pool.getPoolId();

    // set up asset manager
    assetManager = await deploy('SinglePoolTestAssetManager', {
      args: [vault.address, poolId, tokens.DAI.address],
    });

    await tokens.mint({ to: lp, amount: tokenInitialBalance });
    await tokens.approve({ to: vault.address, from: [lp] });

    // Assign assetManager to the DAI token, and other to the other token
    const assetManagers = [assetManager.address, other.address];

    await pool.registerTokens(tokens.addresses, assetManagers);

    await vault.connect(lp).joinPool(poolId, lp.address, other.address, {
      assets: tokens.addresses,
      maxAmountsIn: tokens.addresses.map(() => MAX_UINT256),
      fromInternalBalance: false,
      userData: encodeJoin(
        tokens.addresses.map(() => tokenInitialBalance),
        tokens.addresses.map(() => 0)
      ),
    });
  });

  it('different managers can be set for different tokens', async () => {
    expect((await vault.getPoolTokenInfo(poolId, tokens.DAI.address)).assetManager).to.equal(assetManager.address);
    expect((await vault.getPoolTokenInfo(poolId, tokens.MKR.address)).assetManager).to.equal(other.address);
  });

  it('allows a pool controller to set the desired target investable %', async () => {
    const targetPercentage = fp(0.2);
    const poolController = lp; // TODO

    const updatedConfig = { targetPercentage, criticalPercentage: 0, feePercentage: 0 };
    await assetManager.connect(poolController).setPoolConfig(poolId, updatedConfig);

    const result = await assetManager.getPoolConfig(poolId);
    expect(result.targetPercentage).to.equal(updatedConfig.targetPercentage);
    expect(result.criticalPercentage).to.equal(updatedConfig.criticalPercentage);
    expect(result.feePercentage).to.equal(updatedConfig.feePercentage);
  });

  describe('when a token has been made investable', () => {
    let poolController: SignerWithAddress; // TODO
    const targetPercentage = fp(0.9);

    beforeEach(async () => {
      poolController = lp; // TODO
      await assetManager
        .connect(poolController)
        .setPoolConfig(poolId, { targetPercentage, criticalPercentage: 0, feePercentage: 0 });
    });

    it('transfers only the requested token from the vault to the lending pool via the manager', async () => {
      await expectBalanceChange(() => assetManager.connect(lp).capitalIn(poolId, amount), tokens, [
        { account: assetManager.address, changes: { DAI: amount } },
        { account: vault.address, changes: { DAI: -amount } },
      ]);
    });

    it('transfers the requested token from the lending pool to the vault', async () => {
      let result = await assetManager.maxInvestableBalance(poolId);
      expect(result).to.equal(tokenInitialBalance.mul(9).div(10));

      await assetManager.connect(lp).capitalIn(poolId, amount);
      expect((await vault.getPoolTokenInfo(poolId, tokens.DAI.address)).assetManager).to.equal(assetManager.address);

      const configNoInvestment = { targetPercentage: 0, criticalPercentage: 0, feePercentage: 0 };
      await assetManager.connect(poolController).setPoolConfig(poolId, configNoInvestment);

      result = await assetManager.maxInvestableBalance(poolId);
      expect(result).to.equal(bn(-100e18));

      await expectBalanceChange(() => assetManager.connect(lp).capitalOut(poolId, amount), tokens, [
        { account: assetManager.address, changes: { DAI: -amount } },
        { account: vault.address, changes: { DAI: amount } },
      ]);
    });

    it('allows anyone to withdraw assets to a pool to get to the target investable %', async () => {
      // be overinvested
      await assetManager.connect(lp).capitalIn(poolId, amount);

      const amountToWithdraw = amount.mul(bn(89)).div(bn(100));

      const configNoInvestment = { targetPercentage: 0, criticalPercentage: 0, feePercentage: 0 };
      await assetManager.connect(poolController).setPoolConfig(poolId, configNoInvestment);

      await expectBalanceChange(() => assetManager.connect(lp).capitalOut(poolId, amountToWithdraw), tokens, [
        { account: assetManager.address, changes: { DAI: -amountToWithdraw } },
        { account: vault.address, changes: { DAI: amountToWithdraw } },
      ]);
    });

    it('allows anyone to deposit pool assets to an investment manager to get to the target investable %', async () => {
      const amountToDeposit = tokenInitialBalance.mul(bn(79)).div(bn(100));

      await expectBalanceChange(() => assetManager.connect(lp).capitalIn(poolId, amountToDeposit), tokens, [
        { account: assetManager.address, changes: { DAI: amountToDeposit } },
        { account: vault.address, changes: { DAI: -amountToDeposit } },
      ]);
    });

    it('prevents depositing pool assets to an investment manager over the target investable %', async () => {
      const amountToDeposit = tokenInitialBalance.mul(bn(99)).div(bn(100));

      expect(assetManager.connect(lp).capitalIn(poolId, amountToDeposit)).to.be.revertedWith(
        OVER_INVESTMENT_REVERT_REASON
      );
    });

    it("updates the pool's managed balance", async () => {
      const amountToDeposit = tokenInitialBalance.mul(bn(79)).div(bn(100));

      await assetManager.connect(lp).capitalIn(poolId, amountToDeposit);

      const { managed } = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);
      const actualManagedBalance = await assetManager.readAUM();

      expect(managed).to.be.eq(actualManagedBalance);
    });

    describe('when token is fully invested', () => {
      const amountToDeposit = tokenInitialBalance.mul(bn(9)).div(bn(10));
      beforeEach(async () => {
        await assetManager.connect(lp).capitalIn(poolId, amountToDeposit);

        // should be perfectly balanced
        const maxInvestableBalance = await assetManager.maxInvestableBalance(poolId);
        expect(maxInvestableBalance).to.equal(bn(0));
      });

      context('And a return has been made by the lending pool', async () => {
        beforeEach(async () => {
          // simulate 11% ROI
          const aum = await assetManager.readAUM();
          const newAUM = aum.mul(11).div(10);
          await assetManager.connect(lp).setUnrealisedAUM(newAUM);
          await assetManager.connect(lp).realizeGains();

          await assetManager.connect(lp).updateBalanceOfPool(poolId);
        });

        it("updates the pool's managed balance", async () => {
          const maxInvestableBalance = await assetManager.maxInvestableBalance(poolId);

          // return a portion of the return to the vault to serve as a buffer
          const amountToWithdraw = maxInvestableBalance.abs();

          await assetManager.connect(lp).capitalOut(poolId, amountToWithdraw);

          const { managed } = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);
          const actualManagedBalance = await assetManager.readAUM();

          expect(managed).to.be.eq(actualManagedBalance);
        });

        it('allows the pool to withdraw tokens to rebalance', async () => {
          const maxInvestableBalance = await assetManager.maxInvestableBalance(poolId);

          // return a portion of the return to the vault to serve as a buffer
          const amountToWithdraw = maxInvestableBalance.abs();

          await expectBalanceChange(() => assetManager.connect(lp).capitalOut(poolId, amountToWithdraw), tokens, [
            { account: assetManager.address, changes: { DAI: ['near', -amountToWithdraw] } },
            { account: vault.address, changes: { DAI: ['near', amountToWithdraw] } },
          ]);
        });
      });
    });
  });
});
