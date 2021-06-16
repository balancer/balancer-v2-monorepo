import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { GeneralPool } from '@balancer-labs/v2-helpers/src/models/vault/pools';
import { encodeJoin } from '@balancer-labs/v2-helpers/src/models/pools/mockPool';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { calcRebalanceAmount, encodeInvestmentConfig } from './helpers/rebalance';

const OVER_INVESTMENT_REVERT_REASON = 'investment amount exceeds target';
const UNDER_INVESTMENT_REVERT_REASON = 'withdrawal leaves insufficient balance invested';

const tokenInitialBalance = bn(200e18);

const setup = async () => {
  const [, lp, other] = await ethers.getSigners();

  const tokens = await TokenList.create(['DAI', 'MKR'], { sorted: true });

  // Deploy Balancer Vault
  const vault = await Vault.create();

  // Deploy Pool
  const pool = await deploy('v2-vault/MockPool', { args: [vault.address, GeneralPool] });
  const poolId = await pool.getPoolId();

  // Deploy Asset manager
  const assetManager = await deploy('MockRewardsAssetManager', {
    args: [vault.address, poolId, tokens.DAI.address],
  });

  await tokens.mint({ to: lp, amount: tokenInitialBalance.mul(2) });
  await tokens.approve({ to: vault.address, from: [lp] });

  // Assign assetManager to the DAI token, and other to the other token
  const assetManagers = [assetManager.address, other.address];

  await pool.registerTokens(tokens.addresses, assetManagers);

  await vault.instance.connect(lp).joinPool(poolId, lp.address, lp.address, {
    assets: tokens.addresses,
    maxAmountsIn: tokens.addresses.map(() => MAX_UINT256),
    fromInternalBalance: false,
    userData: encodeJoin(
      tokens.addresses.map(() => tokenInitialBalance),
      tokens.addresses.map(() => 0)
    ),
  });

  return {
    data: {
      poolId,
    },
    contracts: {
      assetManager,
      tokens,
      pool,
      vault: vault.instance,
    },
  };
};

describe('Rewards Asset manager', function () {
  let tokens: TokenList, vault: Contract, assetManager: Contract;

  let lp: SignerWithAddress, other: SignerWithAddress;
  let poolId: string;

  before('deploy base contracts', async () => {
    [, lp, other] = await ethers.getSigners();
  });

  sharedBeforeEach('set up asset manager', async () => {
    const { data, contracts } = await setup();
    poolId = data.poolId;

    assetManager = contracts.assetManager;
    tokens = contracts.tokens;
    vault = contracts.vault;
  });

  describe('deployment', () => {
    it('different managers can be set for different tokens', async () => {
      expect((await vault.getPoolTokenInfo(poolId, tokens.DAI.address)).assetManager).to.equal(assetManager.address);
      expect((await vault.getPoolTokenInfo(poolId, tokens.MKR.address)).assetManager).to.equal(other.address);
    });
  });

  describe('setConfig', () => {
    let poolController: SignerWithAddress;

    sharedBeforeEach(async () => {
      poolController = lp; // TODO
    });

    it('allows a pool controller to set the pools target investment config', async () => {
      const updatedConfig = {
        targetPercentage: 3,
        upperCriticalPercentage: 4,
        lowerCriticalPercentage: 2,
      };
      await assetManager.connect(poolController).setConfig(poolId, encodeInvestmentConfig(updatedConfig));

      const result = await assetManager.getInvestmentConfig(poolId);
      expect(result.targetPercentage).to.equal(updatedConfig.targetPercentage);
      expect(result.upperCriticalPercentage).to.equal(updatedConfig.upperCriticalPercentage);
      expect(result.lowerCriticalPercentage).to.equal(updatedConfig.lowerCriticalPercentage);
    });

    it('emits an event', async () => {
      const updatedConfig = {
        targetPercentage: 3,
        upperCriticalPercentage: 4,
        lowerCriticalPercentage: 2,
      };

      const receipt = await (
        await assetManager.connect(poolController).setConfig(poolId, encodeInvestmentConfig(updatedConfig))
      ).wait();

      expectEvent.inReceipt(receipt, 'InvestmentConfigSet', {
        targetPercentage: updatedConfig.targetPercentage,
        lowerCriticalPercentage: updatedConfig.lowerCriticalPercentage,
        upperCriticalPercentage: updatedConfig.upperCriticalPercentage,
      });
    });

    it('reverts when setting upper critical over 100%', async () => {
      const badConfig = {
        targetPercentage: 0,
        upperCriticalPercentage: fp(1).add(1),
        lowerCriticalPercentage: 0,
      };
      await expect(
        assetManager.connect(poolController).setConfig(poolId, encodeInvestmentConfig(badConfig))
      ).to.be.revertedWith('Upper critical level must be less than or equal to 100%');
    });

    it('reverts when setting upper critical below target', async () => {
      const badConfig = {
        targetPercentage: 1,
        upperCriticalPercentage: 0,
        lowerCriticalPercentage: 0,
      };
      await expect(
        assetManager.connect(poolController).setConfig(poolId, encodeInvestmentConfig(badConfig))
      ).to.be.revertedWith('Target must be less than or equal to upper critical level');
    });

    it('reverts when setting lower critical above target', async () => {
      const badConfig = {
        targetPercentage: 1,
        upperCriticalPercentage: 2,
        lowerCriticalPercentage: 2,
      };
      await expect(
        assetManager.connect(poolController).setConfig(poolId, encodeInvestmentConfig(badConfig))
      ).to.be.revertedWith('Lower critical level must be less than or equal to target');
    });

    it('prevents an unauthorized user from setting the pool config');
  });

  describe('capitalIn', () => {
    context('when a token is below its investment target', () => {
      let poolController: SignerWithAddress; // TODO
      const config = {
        targetPercentage: fp(0.5),
        upperCriticalPercentage: fp(1),
        lowerCriticalPercentage: 0,
      };

      sharedBeforeEach(async () => {
        poolController = lp; // TODO
        await assetManager.connect(poolController).setConfig(poolId, encodeInvestmentConfig(config));
      });

      it('allows anyone to deposit pool assets to an investment manager to get to the target investable %', async () => {
        const amountToDeposit = await assetManager.maxInvestableBalance(poolId);

        await expectBalanceChange(() => assetManager.connect(lp).capitalIn(poolId, amountToDeposit), tokens, [
          { account: assetManager.address, changes: { DAI: amountToDeposit } },
          { account: vault.address, changes: { DAI: amountToDeposit.mul(-1) } },
        ]);
      });

      it('prevents depositing pool assets to an investment manager over the target investable %', async () => {
        const maxInvestment = await assetManager.maxInvestableBalance(poolId);
        const overInvestmentAmount = maxInvestment.add(1);

        expect(assetManager.connect(lp).capitalIn(poolId, overInvestmentAmount)).to.be.revertedWith(
          OVER_INVESTMENT_REVERT_REASON
        );
      });

      it("updates the pool's managed balance", async () => {
        const amountToDeposit = await assetManager.maxInvestableBalance(poolId);

        await assetManager.connect(lp).capitalIn(poolId, amountToDeposit);

        const { managed } = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);
        const actualManagedBalance = await assetManager.getAUM();

        expect(managed).to.be.eq(actualManagedBalance);
      });
    });

    context('when a token is above its investment target', () => {
      let poolController: SignerWithAddress; // TODO

      sharedBeforeEach(async () => {
        const config = {
          targetPercentage: fp(0.5),
          upperCriticalPercentage: fp(1),
          lowerCriticalPercentage: 0,
        };
        poolController = lp; // TODO
        await assetManager.connect(poolController).setConfig(poolId, encodeInvestmentConfig(config));

        const { poolCash } = await assetManager.getPoolBalances(poolId);
        await tokens.DAI.mint(assetManager.address, poolCash.mul(101).div(100));

        // should be overinvested
        const maxInvestableBalance = await assetManager.maxInvestableBalance(poolId);
        expect(maxInvestableBalance).to.be.lt(0);
      });

      it('reverts', async () => {
        const minimalInvestment = 1;
        await expect(assetManager.connect(lp).capitalIn(poolId, minimalInvestment)).revertedWith(
          OVER_INVESTMENT_REVERT_REASON
        );
      });
    });
  });

  describe('capitalOut', () => {
    context('when a token is below its investment target', () => {
      let poolController: SignerWithAddress; // TODO

      sharedBeforeEach(async () => {
        poolController = lp; // TODO
        const config = {
          targetPercentage: fp(0.5),
          upperCriticalPercentage: fp(1),
          lowerCriticalPercentage: 0,
        };
        await assetManager.connect(poolController).setConfig(poolId, encodeInvestmentConfig(config));

        const { poolCash } = await assetManager.getPoolBalances(poolId);
        await tokens.DAI.mint(assetManager.address, poolCash.mul(99).div(100));

        // should be under invested
        const maxInvestableBalance = await assetManager.maxInvestableBalance(poolId);
        expect(maxInvestableBalance).to.gt(0);
      });

      it('reverts', async () => {
        const minimalWithdrawal = 100;
        await expect(assetManager.connect(lp).capitalOut(poolId, minimalWithdrawal)).revertedWith(
          UNDER_INVESTMENT_REVERT_REASON
        );
      });
    });

    context('when a token is above its investment target', () => {
      let poolController: SignerWithAddress; // TODO

      sharedBeforeEach(async () => {
        poolController = lp; // TODO
        const config = {
          targetPercentage: fp(0.5),
          upperCriticalPercentage: fp(1),
          lowerCriticalPercentage: 0,
        };
        poolController = lp; // TODO
        await assetManager.connect(poolController).setConfig(poolId, encodeInvestmentConfig(config));

        const { poolCash } = await assetManager.getPoolBalances(poolId);
        await tokens.DAI.mint(assetManager.address, poolCash.mul(101).div(100));

        // should be overinvested
        const maxInvestableBalance = await assetManager.maxInvestableBalance(poolId);
        expect(maxInvestableBalance).to.be.lt(0);
      });

      it('allows anyone to withdraw assets to a pool to get to the target investable %', async () => {
        const amountToWithdraw = (await assetManager.maxInvestableBalance(poolId)).mul(-1);

        await expectBalanceChange(() => assetManager.connect(lp).capitalOut(poolId, amountToWithdraw), tokens, [
          { account: assetManager.address, changes: { DAI: amountToWithdraw.mul(-1) } },
          { account: vault.address, changes: { DAI: amountToWithdraw } },
        ]);
      });

      it('prevents depositing pool assets to an investment manager over the target investable %', async () => {
        const maxDivestment = (await assetManager.maxInvestableBalance(poolId)).mul(-1);
        const overDivestmentAmount = maxDivestment.add(1);

        expect(assetManager.connect(lp).capitalOut(poolId, overDivestmentAmount)).to.be.revertedWith(
          UNDER_INVESTMENT_REVERT_REASON
        );
      });

      it("updates the pool's managed balance", async () => {
        const maxInvestableBalance = await assetManager.maxInvestableBalance(poolId);

        // return a portion of the return to the vault to serve as a buffer
        const amountToWithdraw = maxInvestableBalance.abs();

        await assetManager.connect(lp).capitalOut(poolId, amountToWithdraw);

        const { managed } = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);
        const actualManagedBalance = await assetManager.getAUM();

        expect(managed.sub(actualManagedBalance)).to.be.lt(10);
      });

      it('allows withdrawing returns which are greater than the current managed balance', async () => {
        const { poolCash, poolManaged } = await assetManager.getPoolBalances(poolId);
        const poolAssets = poolCash.add(poolManaged);

        // Asset manager experiences gains far in excess of pool value
        await tokens.DAI.mint(assetManager.address, poolAssets.mul(10));

        const amountToWithdraw = (await assetManager.maxInvestableBalance(poolId)).mul(-1);

        await expectBalanceChange(() => assetManager.connect(lp).capitalOut(poolId, amountToWithdraw), tokens, [
          { account: assetManager.address, changes: { DAI: -amountToWithdraw } },
          { account: vault.address, changes: { DAI: amountToWithdraw } },
        ]);
      });
    });
  });

  describe('rebalance', () => {
    function itRebalancesCorrectly(force: boolean) {
      it('emits a Rebalance event', async () => {
        const tx = await assetManager.rebalance(poolId, force);
        const receipt = await tx.wait();
        expectEvent.inReceipt(receipt, 'Rebalance');
      });

      it('transfers the expected number of tokens to the Vault', async () => {
        const config = await assetManager.getInvestmentConfig(poolId);
        const { poolCash, poolManaged } = await assetManager.getPoolBalances(poolId);
        const expectedRebalanceAmount = calcRebalanceAmount(poolCash, poolManaged, config);

        await expectBalanceChange(() => assetManager.rebalance(poolId, force), tokens, [
          { account: assetManager.address, changes: { DAI: expectedRebalanceAmount } },
          { account: vault.address, changes: { DAI: expectedRebalanceAmount.mul(-1) } },
        ]);
      });

      it('returns the pool to its target allocation', async () => {
        await assetManager.rebalance(poolId, force);
        const differenceFromTarget = await assetManager.maxInvestableBalance(poolId);
        expect(differenceFromTarget.abs()).to.be.lte(1);
      });

      it("updates the pool's managed balance on the vault correctly", async () => {
        await assetManager.rebalance(poolId, force);
        const { poolManaged: expectedManaged } = await assetManager.getPoolBalances(poolId);
        const { managed: actualManaged } = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);
        expect(actualManaged).to.be.eq(expectedManaged);
      });
    }

    function itSkipsTheRebalance() {
      it('skips the rebalance', async () => {
        const tx = await assetManager.rebalance(poolId, false);
        const receipt = await tx.wait();
        expectEvent.notEmitted(receipt, 'Rebalance');
      });
    }

    const config = {
      targetPercentage: fp(0.5),
      upperCriticalPercentage: fp(0.75),
      lowerCriticalPercentage: fp(0.25),
    };

    sharedBeforeEach(async () => {
      const poolController = lp; // TODO
      await assetManager.connect(poolController).setConfig(poolId, encodeInvestmentConfig(config));
    });

    context('when pool is above target investment level', () => {
      context('when pool is in non-critical range', () => {
        sharedBeforeEach(async () => {
          const { poolCash } = await assetManager.getPoolBalances(poolId);
          await tokens.DAI.mint(assetManager.address, poolCash.mul(101).div(100));

          // should be overinvested
          const maxInvestableBalance = await assetManager.maxInvestableBalance(poolId);
          expect(maxInvestableBalance).to.be.lt(0);
        });

        context('when forced', () => {
          const force = true;
          itRebalancesCorrectly(force);
        });

        context('when not forced', () => {
          itSkipsTheRebalance();
        });
      });
    });

    context('when pool is above upper critical investment level', () => {
      sharedBeforeEach(async () => {
        const { poolCash } = await assetManager.getPoolBalances(poolId);
        // Results in an investment percentage of 80%
        await tokens.DAI.mint(assetManager.address, poolCash.mul(4));
      });

      context('when forced', () => {
        const force = true;
        itRebalancesCorrectly(force);
      });

      context('when not forced', () => {
        const force = false;
        itRebalancesCorrectly(force);
      });
    });

    context('when pool is below target investment level', () => {
      context('when pool is in non-critical range', () => {
        sharedBeforeEach(async () => {
          const poolController = lp; // TODO

          // Ensure that the pool is invested below its target level but above than critical level
          const targetInvestmentAmount = await assetManager.maxInvestableBalance(poolId);
          await assetManager.connect(poolController).capitalIn(poolId, targetInvestmentAmount.mul(99).div(100));
        });

        context('when forced', () => {
          const force = true;
          itRebalancesCorrectly(force);
        });

        context('when not forced', () => {
          itSkipsTheRebalance();
        });
      });

      context('when pool is below lower critical investment level', () => {
        context('when forced', () => {
          const force = true;
          itRebalancesCorrectly(force);
        });

        context('when not forced', () => {
          const force = false;
          itRebalancesCorrectly(force);
        });
      });
    });
  });
});
