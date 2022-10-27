import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { fp, FP_ONE } from '@balancer-labs/v2-helpers/src/numbers';
import { bn } from '../../../pvt/helpers/src/numbers';
import { WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';

describe('ProtocolFeeSplitter', function () {
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
    await vault.grantPermissionsGlobally([setRevenueSharingFeeRole], admin);

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
      const newFee = bn(10e16); // 10%
      await protocolFeeSplitter.connect(admin).setDefaultRevenueSharingFeePercentage(newFee);

      expect(await protocolFeeSplitter.getDefaultRevenueSharingFeePercentage()).to.be.eq(newFee);
    });

    it('emits a DefaultRevenueSharingFeePercentageChanged event', async () => {
      const newFee = bn(10e16); // 10%
      const receipt = await (
        await protocolFeeSplitter.connect(admin).setDefaultRevenueSharingFeePercentage(newFee)
      ).wait();
      expectEvent.inReceipt(receipt, 'DefaultRevenueSharingFeePercentageChanged', { revenueSharePercentage: newFee });
    });

    it('reverts if caller is not authorized', async () => {
      const newFee = bn(10e16); // 10%
      await expect(
        protocolFeeSplitter.connect(liquidityProvider).setDefaultRevenueSharingFeePercentage(newFee)
      ).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });
  });

  describe('setRevenueSharingFeePercentage', async () => {
    it('overrides revenue sharing percentage for a pool', async () => {
      const newFee = bn(50e16); // 50%

      await protocolFeeSplitter.connect(admin).setRevenueSharingFeePercentage(poolId, newFee);

      const poolSettings = await protocolFeeSplitter.getPoolSettings(poolId);
      expect(poolSettings.revenueSharePercentageOverride).to.be.eq(newFee);
    });

    it('emits a PoolRevenueShareChanged event', async () => {
      const newFee = bn(50e16); // 50%
      const receipt = await (
        await protocolFeeSplitter.connect(admin).setRevenueSharingFeePercentage(poolId, newFee)
      ).wait();
      expectEvent.inReceipt(receipt, 'PoolRevenueShareChanged', { poolId, revenueSharePercentage: newFee });
    });

    it('reverts with invalid input', async () => {
      const newFee = bn(50e16).add(1);
      await expect(
        protocolFeeSplitter.connect(admin).setRevenueSharingFeePercentage(poolId, newFee)
      ).to.be.revertedWith('SPLITTER_FEE_PERCENTAGE_TOO_HIGH');
    });

    it('reverts if caller is not authorized', async () => {
      const newFee = bn(10e16); // 10%
      await expect(
        protocolFeeSplitter.connect(other).setRevenueSharingFeePercentage(poolId, newFee)
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

  context('when the fee collector holds BPT', async () => {
    let bptBalanceOfLiquidityProvider: BigNumber;

    sharedBeforeEach('transfers BPT to fees collector', async () => {
      // transfer BPT tokens to feesCollector
      bptBalanceOfLiquidityProvider = await pool.balanceOf(liquidityProvider.address);
      await pool.instance
        .connect(liquidityProvider)
        .transfer((await vault.getFeesCollector()).address, bptBalanceOfLiquidityProvider);
    });

    describe('collect fees', async () => {
      it('distributes collected BPT fees to treasury (beneficiary is not set for a pool)', async () => {
        await protocolFeeSplitter.collectFees(poolId);

        const treasuryBalance = await pool.balanceOf(treasury.address);
        expectEqualWithError(treasuryBalance, bptBalanceOfLiquidityProvider);
      });
    });

    context('fee percentage defined', async () => {
      sharedBeforeEach('sets pool beneficiary & fee percentage', async () => {
        await protocolFeeSplitter.connect(owner).setPoolBeneficiary(poolId, owner.address);
        await protocolFeeSplitter.connect(admin).setRevenueSharingFeePercentage(poolId, fp(0.1));
      });

      describe('get amounts', async () => {
        it('returns correct amounts for beneficiary and treasury', async () => {
          const amounts = await protocolFeeSplitter.getAmounts(poolId);

          // 10% of bptBalanceOfLiquidityProvider should go to owner
          const ownerExpectedBalance = bptBalanceOfLiquidityProvider.mul(fp(0.1)).div(FP_ONE);
          // The rest goes to the treasury
          const treasuryExpectedBalance = bptBalanceOfLiquidityProvider.sub(ownerExpectedBalance);

          expectEqualWithError(amounts.beneficiaryAmount, ownerExpectedBalance);
          expectEqualWithError(amounts.treasuryAmount, treasuryExpectedBalance);
        });
      });

      it('distributes collected BPT fees to pool beneficiary and treasury', async () => {
        await protocolFeeSplitter.collectFees(poolId);

        // 10% of bptBalanceOfLiquidityProvider should go to owner
        const ownerExpectedBalance = bptBalanceOfLiquidityProvider.mul(fp(0.1)).div(FP_ONE);
        // The rest goes to the treasury
        const treasuryExpectedBalance = bptBalanceOfLiquidityProvider.sub(ownerExpectedBalance);

        const ownerBalance = await pool.balanceOf(owner.address);
        const treasuryBalance = await pool.balanceOf(treasury.address);

        expectEqualWithError(ownerBalance, ownerExpectedBalance);
        expectEqualWithError(treasuryBalance, treasuryExpectedBalance);
      });
    });

    describe('collect fees', async () => {
      it('distributes collected BPT fees to owner and treasury (fee percentage not defined)', async () => {
        await protocolFeeSplitter.collectFees(poolId);

        const ownerBalance = await pool.balanceOf(owner.address);
        const treasuryBalance = await pool.balanceOf(treasury.address);

        // pool owner should get 0, and treasury everything if fee is not defined
        expectEqualWithError(ownerBalance, 0);
        expectEqualWithError(treasuryBalance, bptBalanceOfLiquidityProvider);
      });
    });
  });
});
