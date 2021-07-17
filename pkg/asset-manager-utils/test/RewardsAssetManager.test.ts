import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { encodeJoin } from '@balancer-labs/v2-helpers/src/models/pools/mockPool';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { PoolSpecialization } from '@balancer-labs/balancer-js';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import { bn, fp, FP_SCALING_FACTOR } from '@balancer-labs/v2-helpers/src/numbers';
import { calcRebalanceAmount, encodeInvestmentConfig } from './helpers/rebalance';

const tokenInitialBalance = bn(200e18);

const setup = async () => {
  const [, lp, other] = await ethers.getSigners();

  const tokens = await TokenList.create(['DAI', 'MKR'], { sorted: true });

  // Deploy Balancer Vault
  const vault = await Vault.create();

  // Deploy Pool
  const pool = await deploy('MockAssetManagedPool', { args: [vault.address, PoolSpecialization.GeneralPool] });
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
  let tokens: TokenList, vault: Contract, assetManager: Contract, pool: Contract;

  let other: SignerWithAddress;
  let poolId: string;

  before('deploy base contracts', async () => {
    [, , other] = await ethers.getSigners();
  });

  sharedBeforeEach('set up asset manager', async () => {
    const { data, contracts } = await setup();
    poolId = data.poolId;

    assetManager = contracts.assetManager;
    pool = contracts.pool;
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
    it('allows a pool controller to set the pools target investment config', async () => {
      const updatedConfig = {
        targetPercentage: 3,
        upperCriticalPercentage: 4,
        lowerCriticalPercentage: 2,
      };
      await pool.setAssetManagerPoolConfig(assetManager.address, encodeInvestmentConfig(updatedConfig));

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
        await pool.setAssetManagerPoolConfig(assetManager.address, encodeInvestmentConfig(updatedConfig))
      ).wait();

      expectEvent.inIndirectReceipt(receipt, assetManager.interface, 'InvestmentConfigSet', {
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
        pool.setAssetManagerPoolConfig(assetManager.address, encodeInvestmentConfig(badConfig))
      ).to.be.revertedWith('Upper critical level must be less than or equal to 100%');
    });

    it('reverts when setting upper critical below target', async () => {
      const badConfig = {
        targetPercentage: 1,
        upperCriticalPercentage: 0,
        lowerCriticalPercentage: 0,
      };
      await expect(
        pool.setAssetManagerPoolConfig(assetManager.address, encodeInvestmentConfig(badConfig))
      ).to.be.revertedWith('Target must be less than or equal to upper critical level');
    });

    it('reverts when setting lower critical above target', async () => {
      const badConfig = {
        targetPercentage: 1,
        upperCriticalPercentage: 2,
        lowerCriticalPercentage: 2,
      };
      await expect(
        pool.setAssetManagerPoolConfig(assetManager.address, encodeInvestmentConfig(badConfig))
      ).to.be.revertedWith('Lower critical level must be less than or equal to target');
    });

    it('prevents an unauthorized user from setting the pool config', async () => {
      const updatedConfig = {
        targetPercentage: 3,
        upperCriticalPercentage: 4,
        lowerCriticalPercentage: 2,
      };

      await expect(
        assetManager.connect(other).setConfig(poolId, encodeInvestmentConfig(updatedConfig))
      ).to.be.revertedWith('Only callable by pool');
    });
  });

  describe('rebalance', () => {
    function itShouldRebalance(shouldRebalance: boolean) {
      it(`shouldRebalance returns ${shouldRebalance}`, async () => {
        const { poolCash, poolManaged } = await assetManager.getPoolBalances(poolId);
        expect(await assetManager.shouldRebalance(poolCash, poolManaged)).to.be.eq(shouldRebalance);
      });
    }

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

    // Balances that make the Asset Manager be at the critical percentages
    let lowerCriticalBalance: BigNumber;
    let upperCriticalBalance: BigNumber;

    sharedBeforeEach(async () => {
      await pool.setAssetManagerPoolConfig(assetManager.address, encodeInvestmentConfig(config));

      const { poolCash } = await assetManager.getPoolBalances(poolId);

      lowerCriticalBalance = poolCash
        .mul(config.lowerCriticalPercentage)
        .div(FP_SCALING_FACTOR.sub(config.lowerCriticalPercentage));

      upperCriticalBalance = poolCash
        .mul(config.upperCriticalPercentage)
        .div(FP_SCALING_FACTOR.sub(config.upperCriticalPercentage));
    });

    context('when pool is above target investment level', () => {
      context('when pool is in non-critical range', () => {
        sharedBeforeEach(async () => {
          await tokens.DAI.mint(assetManager.address, upperCriticalBalance.mul(99).div(100));
        });

        itShouldRebalance(false);

        context('when forced', () => {
          const force = true;
          itRebalancesCorrectly(force);
        });

        context('when not forced', () => {
          itSkipsTheRebalance();
        });
      });

      context('when pool is above upper critical investment level', () => {
        sharedBeforeEach(async () => {
          await tokens.DAI.mint(assetManager.address, upperCriticalBalance.mul(101).div(100));
        });

        itShouldRebalance(true);

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

    context('when pool is below target investment level', () => {
      context('when pool is in non-critical range', () => {
        sharedBeforeEach(async () => {
          await tokens.DAI.mint(assetManager.address, lowerCriticalBalance.mul(101).div(100));
        });

        itShouldRebalance(false);

        context('when forced', () => {
          const force = true;
          itRebalancesCorrectly(force);
        });

        context('when not forced', () => {
          itSkipsTheRebalance();
        });
      });

      context('when pool is below lower critical investment level', () => {
        sharedBeforeEach(async () => {
          await tokens.DAI.mint(assetManager.address, lowerCriticalBalance.mul(99).div(100));
        });

        itShouldRebalance(true);

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
