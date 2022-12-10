import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { fp, fpMul, FP_ZERO } from '@balancer-labs/v2-helpers/src/numbers';
import { WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';

describe('ProtocolFeeSplitter', function () {
  const defaultRevenueShare = fp(0.1); // 10%
  const poolRevenueShare = fp(0.5); // 50%

  let vault: Vault;

  let protocolFeeSplitter: Contract;
  let protocolFeesWithdrawer: Contract;

  let admin: SignerWithAddress,
    owner: SignerWithAddress,
    treasury: SignerWithAddress,
    newTreasury: SignerWithAddress,
    liquidityProvider: SignerWithAddress,
    other: SignerWithAddress;

  let tokens: TokenList;

  let pool: WeightedPool;
  let poolId: string;

  before(async () => {
    [, admin, owner, liquidityProvider, treasury, newTreasury, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault, protocol fees collector & tokens', async () => {
    vault = await Vault.create({ admin });
    tokens = await TokenList.create(['DAI', 'MKR', 'SNX', 'BAT'], { sorted: true });

    await tokens.mint({ to: liquidityProvider, amount: fp(100000) });
    await tokens.approve({ from: liquidityProvider, to: vault });
  });

  sharedBeforeEach('create and initialize pools', async () => {
    pool = await WeightedPool.create({ vault, tokens, owner });
    poolId = await pool.getPoolId();

    const initialBalances = Array(tokens.length).fill(fp(1000));

    await vault.instance
      .connect(liquidityProvider)
      .joinPool(poolId, liquidityProvider.address, liquidityProvider.address, {
        assets: tokens.addresses,
        maxAmountsIn: initialBalances,
        userData: WeightedPoolEncoder.joinInit(initialBalances),
        fromInternalBalance: false,
      });
  });

  sharedBeforeEach('deploy ProtocolFeeSplitter, ProtocolFeesWithdrawer & grant permissions', async () => {
    protocolFeesWithdrawer = await deploy('ProtocolFeesWithdrawer', {
      args: [vault.address, []],
    });

    protocolFeeSplitter = await deploy('ProtocolFeeSplitter', {
      args: [protocolFeesWithdrawer.address, treasury.address],
    });

    const setRevenueSharingFeeRole = await actionId(protocolFeeSplitter, 'setRevenueSharingFeePercentage');
    const clearRevenueSharingFeeRole = await actionId(protocolFeeSplitter, 'clearRevenueSharingFeePercentage');
    await vault.grantPermissionsGlobally([setRevenueSharingFeeRole, clearRevenueSharingFeeRole], admin);

    const setDefaultRevenueSharingFeePercentageRole = await actionId(
      protocolFeeSplitter,
      'setDefaultRevenueSharingFeePercentage'
    );
    await vault.grantPermissionsGlobally([setDefaultRevenueSharingFeePercentageRole], admin);

    // Allow withdrawer to pull from collector
    const withdrawCollectedFeesRole = await actionId(await vault.getFeesCollector(), 'withdrawCollectedFees');
    await vault.grantPermissionsGlobally([withdrawCollectedFeesRole], protocolFeesWithdrawer);

    // Allow fee splitter to pull from withdrawer
    const withdrawCollectedFeesWithdrawerRole = await actionId(protocolFeesWithdrawer, 'withdrawCollectedFees');
    await vault.grantPermissionsGlobally([withdrawCollectedFeesWithdrawerRole], protocolFeeSplitter);

    const setTreasuryRole = await actionId(protocolFeeSplitter, 'setTreasury');
    await vault.grantPermissionsGlobally([setTreasuryRole], admin);
  });

  describe('constructor', () => {
    it('sets the protocolFeesWithdrawer', async () => {
      expect(await protocolFeeSplitter.getProtocolFeesWithdrawer()).to.be.eq(protocolFeesWithdrawer.address);
    });

    it('sets the treasury', async () => {
      expect(await protocolFeeSplitter.getTreasury()).to.be.eq(treasury.address);
    });
  });

  describe('setTreasury', async () => {
    it('changes the treasury', async () => {
      await protocolFeeSplitter.connect(admin).setTreasury(newTreasury.address);
      expect(await protocolFeeSplitter.getTreasury()).to.eq(newTreasury.address);
    });

    it('emits a TreasuryChanged event', async () => {
      const receipt = await (await protocolFeeSplitter.connect(admin).setTreasury(newTreasury.address)).wait();
      expectEvent.inReceipt(receipt, 'TreasuryChanged', { newTreasury: newTreasury.address });
    });

    it('reverts if caller is unauthorized', async () => {
      await expect(protocolFeeSplitter.connect(other).setTreasury(newTreasury.address)).to.be.revertedWith(
        'SENDER_NOT_ALLOWED'
      );
    });
  });

  describe('setDefaultRevenueSharingFeePercentage', async () => {
    it('sets default fee', async () => {
      await protocolFeeSplitter.connect(admin).setDefaultRevenueSharingFeePercentage(defaultRevenueShare);

      expect(await protocolFeeSplitter.getDefaultRevenueSharingFeePercentage()).to.be.eq(defaultRevenueShare);
    });

    it('emits a DefaultRevenueSharingFeePercentageChanged event', async () => {
      const receipt = await (
        await protocolFeeSplitter.connect(admin).setDefaultRevenueSharingFeePercentage(defaultRevenueShare)
      ).wait();
      expectEvent.inReceipt(receipt, 'DefaultRevenueSharingFeePercentageChanged', {
        revenueSharePercentage: defaultRevenueShare,
      });
    });

    it('reverts if caller is not authorized', async () => {
      await expect(
        protocolFeeSplitter.connect(liquidityProvider).setDefaultRevenueSharingFeePercentage(defaultRevenueShare)
      ).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });
  });

  describe('setRevenueSharingFeePercentage', async () => {
    sharedBeforeEach('set default fee', async () => {
      await protocolFeeSplitter.connect(admin).setDefaultRevenueSharingFeePercentage(defaultRevenueShare);

      expect(await protocolFeeSplitter.getDefaultRevenueSharingFeePercentage()).to.be.eq(defaultRevenueShare);
    });

    it('uses the default value when not set', async () => {
      const poolSettings = await protocolFeeSplitter.getPoolSettings(poolId);

      expect(poolSettings.overrideSet).to.be.false;
    });

    it('overrides revenue sharing percentage for a pool', async () => {
      await protocolFeeSplitter.connect(admin).setRevenueSharingFeePercentage(poolId, poolRevenueShare);

      const poolSettings = await protocolFeeSplitter.getPoolSettings(poolId);
      expect(poolSettings.revenueSharePercentageOverride).to.be.eq(poolRevenueShare);
      expect(poolSettings.overrideSet).to.be.true;
    });

    it('emits a PoolRevenueShareChanged event', async () => {
      const receipt = await (
        await protocolFeeSplitter.connect(admin).setRevenueSharingFeePercentage(poolId, poolRevenueShare)
      ).wait();
      expectEvent.inReceipt(receipt, 'PoolRevenueShareChanged', { poolId, revenueSharePercentage: poolRevenueShare });
    });

    it('allows a revenue sharing percentage of zero', async () => {
      await protocolFeeSplitter.connect(admin).setRevenueSharingFeePercentage(poolId, FP_ZERO);

      const poolSettings = await protocolFeeSplitter.getPoolSettings(poolId);
      expect(poolSettings.revenueSharePercentageOverride).to.be.eq(FP_ZERO);
      expect(poolSettings.overrideSet).to.be.true;
    });

    it('reverts with invalid input', async () => {
      const invalidFee = fp(0.5).add(1);

      await expect(
        protocolFeeSplitter.connect(admin).setRevenueSharingFeePercentage(poolId, invalidFee)
      ).to.be.revertedWith('SPLITTER_FEE_PERCENTAGE_TOO_HIGH');
    });

    it('reverts if caller is not authorized', async () => {
      await expect(
        protocolFeeSplitter.connect(other).setRevenueSharingFeePercentage(poolId, poolRevenueShare)
      ).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });
  });

  describe('setPoolBeneficiary', async () => {
    it('reverts if caller is not the pool owner', async () => {
      await expect(
        protocolFeeSplitter.connect(liquidityProvider).setPoolBeneficiary(poolId, liquidityProvider.address)
      ).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });

    it('sets pool beneficiary', async () => {
      await protocolFeeSplitter.connect(owner).setPoolBeneficiary(poolId, other.address);
      const poolSettings = await protocolFeeSplitter.getPoolSettings(poolId);
      expect(poolSettings.beneficiary).to.be.eq(other.address);
    });

    it('emits a PoolBeneficiaryChanged event', async () => {
      const receipt = await (await protocolFeeSplitter.connect(owner).setPoolBeneficiary(poolId, other.address)).wait();
      expectEvent.inReceipt(receipt, 'PoolBeneficiaryChanged', {
        poolId,
        newBeneficiary: other.address,
      });
    });
  });

  describe('when the fee collector holds BPT', () => {
    let bptBalanceOfLiquidityProvider: BigNumber;

    sharedBeforeEach('transfer BPT to fees collector', async () => {
      // transfer BPT tokens to feesCollector
      bptBalanceOfLiquidityProvider = await pool.balanceOf(liquidityProvider.address);
      await pool.instance
        .connect(liquidityProvider)
        .transfer((await vault.getFeesCollector()).address, bptBalanceOfLiquidityProvider);

      await protocolFeeSplitter.connect(admin).setDefaultRevenueSharingFeePercentage(defaultRevenueShare);
    });

    async function itShouldDistributeRevenueCorrectly(
      ownerExpectedBalance: BigNumber,
      treasuryExpectedBalance: BigNumber
    ) {
      await protocolFeeSplitter.collectFees(poolId);

      const ownerBalance = await pool.balanceOf(owner.address);
      const treasuryBalance = await pool.balanceOf(treasury.address);

      expectEqualWithError(ownerBalance, ownerExpectedBalance);
      expectEqualWithError(treasuryBalance, treasuryExpectedBalance);
    }

    context('without a beneficiary', () => {
      it('sends all fees to the treasury', async () => {
        const ownerExpectedBalance = FP_ZERO;
        const treasuryExpectedBalance = bptBalanceOfLiquidityProvider;

        await itShouldDistributeRevenueCorrectly(ownerExpectedBalance, treasuryExpectedBalance);
      });
    });

    describe('with a beneficiary', () => {
      sharedBeforeEach('set pool beneficiary', async () => {
        await protocolFeeSplitter.connect(owner).setPoolBeneficiary(poolId, owner.address);
      });

      context('with no revenue share override', () => {
        it('should collect the default pool revenue share', async () => {
          const ownerExpectedBalance = fpMul(bptBalanceOfLiquidityProvider, defaultRevenueShare);
          const treasuryExpectedBalance = bptBalanceOfLiquidityProvider.sub(ownerExpectedBalance);

          await itShouldDistributeRevenueCorrectly(ownerExpectedBalance, treasuryExpectedBalance);
        });
      });

      context('with a non-zero revenue share override', () => {
        sharedBeforeEach('set the revenue sharing percentage', async () => {
          await protocolFeeSplitter.connect(admin).setRevenueSharingFeePercentage(poolId, poolRevenueShare);
        });

        it('should collect the pool revenue share', async () => {
          // Should use the override value for the owner share
          const ownerExpectedBalance = fpMul(bptBalanceOfLiquidityProvider, poolRevenueShare);
          const treasuryExpectedBalance = bptBalanceOfLiquidityProvider.sub(ownerExpectedBalance);

          await itShouldDistributeRevenueCorrectly(ownerExpectedBalance, treasuryExpectedBalance);
        });

        describe('disable revenue sharing', () => {
          it('emits a PoolRevenueShareChanged event', async () => {
            const receipt = await (
              await protocolFeeSplitter.connect(admin).clearRevenueSharingFeePercentage(poolId)
            ).wait();
            expectEvent.inReceipt(receipt, 'PoolRevenueShareChanged', {
              poolId,
              revenueSharePercentage: defaultRevenueShare,
            });
          });

          it('reverts if caller is not authorized', async () => {
            await expect(
              protocolFeeSplitter.connect(other).clearRevenueSharingFeePercentage(poolId)
            ).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });

          context('when revenue sharing disabled', () => {
            sharedBeforeEach('disable revenue sharing', async () => {
              await protocolFeeSplitter.connect(admin).clearRevenueSharingFeePercentage(poolId);
            });

            it('should now resume collecting the default revenue share', async () => {
              const ownerExpectedBalance = fpMul(bptBalanceOfLiquidityProvider, defaultRevenueShare);
              const treasuryExpectedBalance = bptBalanceOfLiquidityProvider.sub(ownerExpectedBalance);

              await itShouldDistributeRevenueCorrectly(ownerExpectedBalance, treasuryExpectedBalance);
            });
          });
        });
      });

      context('with a zero revenue share override', () => {
        sharedBeforeEach('set the revenue sharing percentage to zero', async () => {
          await protocolFeeSplitter.connect(admin).setRevenueSharingFeePercentage(poolId, FP_ZERO);
        });

        it('should send all funds to the treasury', async () => {
          // Should send everything to the treasury
          const ownerExpectedBalance = FP_ZERO;
          const treasuryExpectedBalance = bptBalanceOfLiquidityProvider;

          await itShouldDistributeRevenueCorrectly(ownerExpectedBalance, treasuryExpectedBalance);
        });
      });
    });
  });
});
