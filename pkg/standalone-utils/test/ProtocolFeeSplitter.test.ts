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

    const setRevenueShareRole = await actionId(protocolFeeSplitter, 'setRevenueSharePercentage');
    const clearRevenueShareRole = await actionId(protocolFeeSplitter, 'clearRevenueSharePercentage');
    await vault.grantPermissionGlobally(setRevenueShareRole, admin);
    await vault.grantPermissionGlobally(clearRevenueShareRole, admin);

    const setDefaultRevenueSharePercentageRole = await actionId(
      protocolFeeSplitter,
      'setDefaultRevenueSharePercentage'
    );
    await vault.grantPermissionGlobally(setDefaultRevenueSharePercentageRole, admin);

    // Allow withdrawer to pull from collector
    const withdrawCollectedFeesRole = await actionId(await vault.getFeesCollector(), 'withdrawCollectedFees');
    await vault.grantPermissionGlobally(withdrawCollectedFeesRole, protocolFeesWithdrawer);

    // Allow fee splitter to pull from withdrawer
    const withdrawCollectedFeesWithdrawerRole = await actionId(protocolFeesWithdrawer, 'withdrawCollectedFees');
    await vault.grantPermissionGlobally(withdrawCollectedFeesWithdrawerRole, protocolFeeSplitter);

    const setTreasuryRole = await actionId(protocolFeeSplitter, 'setDaoFundsRecipient');
    await vault.grantPermissionGlobally(setTreasuryRole, admin);
  });

  describe('constructor', () => {
    it('sets the protocolFeesWithdrawer', async () => {
      expect(await protocolFeeSplitter.getProtocolFeesWithdrawer()).to.be.eq(protocolFeesWithdrawer.address);
    });

    it('sets the treasury', async () => {
      expect(await protocolFeeSplitter.getDaoFundsRecipient()).to.be.eq(treasury.address);
    });
  });

  describe('setTreasury', async () => {
    it('changes the treasury', async () => {
      await protocolFeeSplitter.connect(admin).setDaoFundsRecipient(newTreasury.address);
      expect(await protocolFeeSplitter.getDaoFundsRecipient()).to.eq(newTreasury.address);
    });

    it('emits a DAOFundsRecipientChanged event', async () => {
      const receipt = await (await protocolFeeSplitter.connect(admin).setDaoFundsRecipient(newTreasury.address)).wait();
      expectEvent.inReceipt(receipt, 'DAOFundsRecipientChanged', { newDaoFundsRecipient: newTreasury.address });
    });

    it('reverts if caller is unauthorized', async () => {
      await expect(protocolFeeSplitter.connect(other).setDaoFundsRecipient(newTreasury.address)).to.be.revertedWith(
        'SENDER_NOT_ALLOWED'
      );
    });
  });

  describe('setDefaultRevenueSharePercentage', async () => {
    it('sets default fee', async () => {
      await protocolFeeSplitter.connect(admin).setDefaultRevenueSharePercentage(defaultRevenueShare);

      expect(await protocolFeeSplitter.getDefaultRevenueSharePercentage()).to.be.eq(defaultRevenueShare);
    });

    it('emits a DefaultRevenueSharePercentageChanged event', async () => {
      const receipt = await (
        await protocolFeeSplitter.connect(admin).setDefaultRevenueSharePercentage(defaultRevenueShare)
      ).wait();
      expectEvent.inReceipt(receipt, 'DefaultRevenueSharePercentageChanged', {
        revenueSharePercentage: defaultRevenueShare,
      });
    });

    it('reverts if caller is not authorized', async () => {
      await expect(
        protocolFeeSplitter.connect(liquidityProvider).setDefaultRevenueSharePercentage(defaultRevenueShare)
      ).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });
  });

  describe('setRevenueSharingFeePercentage', async () => {
    sharedBeforeEach('set default fee', async () => {
      await protocolFeeSplitter.connect(admin).setDefaultRevenueSharePercentage(defaultRevenueShare);

      expect(await protocolFeeSplitter.getDefaultRevenueSharePercentage()).to.be.eq(defaultRevenueShare);
    });

    it('uses the default value when not set', async () => {
      const poolSettings = await protocolFeeSplitter.getRevenueShareSettings(poolId);

      expect(poolSettings.overrideSet).to.be.false;
    });

    it('overrides revenue sharing percentage for a pool', async () => {
      await protocolFeeSplitter.connect(admin).setRevenueSharePercentage(poolId, poolRevenueShare);

      const poolSettings = await protocolFeeSplitter.getRevenueShareSettings(poolId);
      expect(poolSettings.revenueSharePercentageOverride).to.be.eq(poolRevenueShare);
      expect(poolSettings.overrideSet).to.be.true;
    });

    it('emits a PoolRevenueShareChanged event', async () => {
      const receipt = await (
        await protocolFeeSplitter.connect(admin).setRevenueSharePercentage(poolId, poolRevenueShare)
      ).wait();
      expectEvent.inReceipt(receipt, 'PoolRevenueShareChanged', { poolId, revenueSharePercentage: poolRevenueShare });
    });

    it('allows a revenue sharing percentage of zero', async () => {
      await protocolFeeSplitter.connect(admin).setRevenueSharePercentage(poolId, FP_ZERO);

      const poolSettings = await protocolFeeSplitter.getRevenueShareSettings(poolId);
      expect(poolSettings.revenueSharePercentageOverride).to.be.eq(FP_ZERO);
      expect(poolSettings.overrideSet).to.be.true;
    });

    it('reverts with invalid input', async () => {
      const invalidFee = fp(0.5).add(1);

      await expect(protocolFeeSplitter.connect(admin).setRevenueSharePercentage(poolId, invalidFee)).to.be.revertedWith(
        'SPLITTER_FEE_PERCENTAGE_TOO_HIGH'
      );
    });

    it('reverts if caller is not authorized', async () => {
      await expect(
        protocolFeeSplitter.connect(other).setRevenueSharePercentage(poolId, poolRevenueShare)
      ).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });
  });

  describe('setPoolBeneficiary', () => {
    let caller: SignerWithAddress;

    function itReverts(): void {
      it('it reverts', async () => {
        await expect(
          protocolFeeSplitter.connect(caller).setPoolBeneficiary(poolId, liquidityProvider.address)
        ).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    }

    function itSetsThePoolsBeneficiary(): void {
      it('sets pool beneficiary', async () => {
        await protocolFeeSplitter.connect(caller).setPoolBeneficiary(poolId, other.address);
        const poolSettings = await protocolFeeSplitter.getRevenueShareSettings(poolId);
        expect(poolSettings.beneficiary).to.be.eq(other.address);
      });

      it('emits a PoolBeneficiaryChanged event', async () => {
        const tx = await protocolFeeSplitter.connect(caller).setPoolBeneficiary(poolId, other.address);
        expectEvent.inReceipt(await tx.wait(), 'PoolBeneficiaryChanged', {
          poolId,
          newBeneficiary: other.address,
        });
      });
    }

    describe('called by pool owner', () => {
      sharedBeforeEach(async () => {
        caller = owner;
      });

      itSetsThePoolsBeneficiary();
    });

    describe('called by governance-authorized address', () => {
      sharedBeforeEach('set permissions', async () => {
        caller = other;
        const setBeneficiaryRole = await actionId(protocolFeeSplitter, 'setPoolBeneficiary');
        await vault.grantPermissionGlobally(setBeneficiaryRole, other);
      });

      itSetsThePoolsBeneficiary();
    });

    describe('called by other', () => {
      sharedBeforeEach(async () => {
        caller = other;
      });

      itReverts();
    });
  });

  context('when the fee collector holds BPT', async () => {
    let bptBalanceOfLiquidityProvider: BigNumber;

    sharedBeforeEach('transfer BPT to fees collector', async () => {
      // transfer BPT tokens to feesCollector
      bptBalanceOfLiquidityProvider = await pool.balanceOf(liquidityProvider.address);
      await pool.instance
        .connect(liquidityProvider)
        .transfer((await vault.getFeesCollector()).address, bptBalanceOfLiquidityProvider);

      await protocolFeeSplitter.connect(admin).setDefaultRevenueSharePercentage(defaultRevenueShare);
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
          await protocolFeeSplitter.connect(admin).setRevenueSharePercentage(poolId, poolRevenueShare);
        });

        it('should collect the pool revenue share', async () => {
          // Should use the override value for the owner share
          const ownerExpectedBalance = fpMul(bptBalanceOfLiquidityProvider, poolRevenueShare);
          const treasuryExpectedBalance = bptBalanceOfLiquidityProvider.sub(ownerExpectedBalance);

          await itShouldDistributeRevenueCorrectly(ownerExpectedBalance, treasuryExpectedBalance);
        });

        describe('disable revenue sharing', () => {
          it('emits a PoolRevenueShareCleared event', async () => {
            const receipt = await (await protocolFeeSplitter.connect(admin).clearRevenueSharePercentage(poolId)).wait();

            expectEvent.inReceipt(receipt, 'PoolRevenueShareCleared', { poolId });
          });

          it('reverts if caller is not authorized', async () => {
            await expect(protocolFeeSplitter.connect(other).clearRevenueSharePercentage(poolId)).to.be.revertedWith(
              'SENDER_NOT_ALLOWED'
            );
          });

          context('when revenue sharing disabled', () => {
            sharedBeforeEach('disable revenue sharing', async () => {
              await protocolFeeSplitter.connect(admin).clearRevenueSharePercentage(poolId);
            });

            it('should now resume collecting the default revenue share', async () => {
              const ownerExpectedBalance = fpMul(bptBalanceOfLiquidityProvider, defaultRevenueShare);
              const treasuryExpectedBalance = bptBalanceOfLiquidityProvider.sub(ownerExpectedBalance);

              await itShouldDistributeRevenueCorrectly(ownerExpectedBalance, treasuryExpectedBalance);
            });
          });
        });
      });

      it('emits an event with collected fees', async () => {
        const tx = await protocolFeeSplitter.collectFees(poolId);
        const receipt = await tx.wait();

        // 10% of bptBalanceOfLiquidityProvider should go to owner
        const ownerExpectedBalance = fpMul(bptBalanceOfLiquidityProvider, defaultRevenueShare);
        // The rest goes to the treasury
        const treasuryExpectedBalance = bptBalanceOfLiquidityProvider.sub(ownerExpectedBalance);

        expectEvent.inReceipt(receipt, 'FeesCollected', {
          poolId,
          beneficiary: owner.address,
          poolEarned: ownerExpectedBalance,
          daoFundsRecipient: treasury.address,
          daoEarned: treasuryExpectedBalance,
        });
      });

      context('with a zero revenue share override', () => {
        sharedBeforeEach('set the revenue sharing percentage to zero', async () => {
          await protocolFeeSplitter.connect(admin).setRevenueSharePercentage(poolId, FP_ZERO);
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
