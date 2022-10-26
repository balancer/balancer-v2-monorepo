import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { toNormalizedWeights } from '@balancer-labs/balancer-js/src';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { bn } from '../../../pvt/helpers/src/numbers';
import { JoinPoolRequest, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

const NAME = 'Balancer Pool Token';
const SYMBOL = 'BPT';
const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
const WEIGHTS = toNormalizedWeights([fp(30), fp(70), fp(5), fp(5)]);

describe('ProtocolFeeSplitter', function () {
  let vault: Vault;
  let factory: Contract;
  let protocolFeesCollector: Contract;
  let protocolFeeSplitter: Contract;
  let protocolFeesWithdrawer: Contract;
  let pool: Contract;
  let admin: SignerWithAddress,
    poolOwner: SignerWithAddress,
    treasury: SignerWithAddress,
    newTreasury: SignerWithAddress,
    liquidityProvider: SignerWithAddress;
  let assetManagers: string[];
  let tokens: TokenList;
  let poolId: string;

  before(async () => {
    [, admin, poolOwner, liquidityProvider, treasury, newTreasury] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault, protocol fees collector & tokens', async () => {
    vault = await Vault.create({ admin });
    protocolFeesCollector = await vault.getFeesCollector();
    tokens = await TokenList.create(['DAI', 'MKR', 'SNX', 'BAT'], { sorted: true });

    await tokens.mint({ to: liquidityProvider, amount: fp(100000) });
    await tokens.approve({ from: liquidityProvider, to: vault });
  });

  sharedBeforeEach('deploy tokens, pools & gives initial liquidity', async () => {
    factory = await deploy('v2-pool-weighted/WeightedPoolFactory', {
      args: [vault.address, vault.getFeesProvider().address],
    });
    assetManagers = Array(tokens.length).fill(ZERO_ADDRESS);
    pool = await createPool(poolOwner.address);
    poolId = await pool.getPoolId();

    const initialBalances = Array(tokens.length).fill(fp(1000));

    const request: JoinPoolRequest = {
      assets: tokens.addresses,
      maxAmountsIn: initialBalances,
      userData: WeightedPoolEncoder.joinInit(initialBalances),
      fromInternalBalance: false,
    };

    await vault.instance
      .connect(liquidityProvider)
      .joinPool(poolId, liquidityProvider.address, liquidityProvider.address, request);
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
    const withdrawCollectedFeesRole = await actionId(protocolFeesCollector, 'withdrawCollectedFees');
    await vault.grantPermissionsGlobally([withdrawCollectedFeesRole], protocolFeesWithdrawer);

    // Allow fee splitter to pull from withdrawer
    const withdrawCollectedFeesWithdrawerRole = await actionId(protocolFeesWithdrawer, 'withdrawCollectedFees');
    await vault.grantPermissionsGlobally([withdrawCollectedFeesWithdrawerRole], protocolFeeSplitter);

    const setTreasuryRole = await actionId(protocolFeeSplitter, 'setTreasury');
    await vault.grantPermissionsGlobally([setTreasuryRole], admin);
  });

  async function createPool(poolOwnerAddress: string): Promise<Contract> {
    const receipt = await (
      await factory.create(
        NAME,
        SYMBOL,
        tokens.addresses,
        WEIGHTS,
        assetManagers,
        POOL_SWAP_FEE_PERCENTAGE,
        poolOwnerAddress
      )
    ).wait();

    const event = expectEvent.inReceipt(receipt, 'PoolCreated');
    return deployedAt('v2-pool-weighted/WeightedPool', event.args.pool);
  }

  describe('constructor', () => {
    it('sets the protocolFeesWithdrawer', async () => {
      expect(await protocolFeeSplitter.protocolFeesWithdrawer()).to.be.eq(protocolFeesWithdrawer.address);
    });
    it('sets the treasury', async () => {
      expect(await protocolFeeSplitter.treasury()).to.be.eq(treasury.address);
    });
  });

  it('changes the treasury', async () => {
    const receipt = await (await protocolFeeSplitter.connect(admin).setTreasury(newTreasury.address)).wait();
    expectEvent.inReceipt(receipt, 'TreasuryChanged', { newTreasury: newTreasury.address });
  });

  describe('default revenue sharing fee', async () => {
    it('sets default fee', async () => {
      const newFee = bn(10e16); // 10%
      const receipt = await (
        await protocolFeeSplitter.connect(admin).setDefaultRevenueSharingFeePercentage(newFee)
      ).wait();
      expectEvent.inReceipt(receipt, 'DefaultRevenueSharingFeePercentageChanged', { revenueSharePercentage: newFee });
      expect(await protocolFeeSplitter.defaultRevenueSharingFeePercentage()).to.be.eq(newFee);
    });
  });

  describe('revenue sharing override', async () => {
    it('overrides revenue sharing percentage for a pool', async () => {
      const newFee = bn(50e16); // 50%
      const receipt = await (
        await protocolFeeSplitter.connect(admin).setRevenueSharingFeePercentage(poolId, newFee)
      ).wait();
      expectEvent.inReceipt(receipt, 'PoolRevenueShareChanged', { poolId: poolId, revenueSharePercentage: newFee });
    });

    it('reverts with invalid input', async () => {
      const newFee = bn(100e16); // 100%
      await expect(
        protocolFeeSplitter.connect(admin).setRevenueSharingFeePercentage(poolId, newFee)
      ).to.be.revertedWith('SPLITTER_FEE_PERCENTAGE_TOO_HIGH');
    });
  });

  describe('pool beneficiary', async () => {
    it('reverts if caller is not the pool owner', async () => {
      await expect(
        protocolFeeSplitter.connect(liquidityProvider).setPoolBeneficiary(poolId, liquidityProvider.address)
      ).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });
  });

  describe('collect fees', async () => {
    it('reverts if no BPT collected', async () => {
      expect(await pool.balanceOf(protocolFeesCollector.address)).to.equal(0);
      await expect(protocolFeeSplitter.collectFees(poolId)).to.be.revertedWith('NO_BPT_FEES_COLLECTED');
    });

    it('distributes collected BPT fees to owner and treasury (fee percentage not defined)', async () => {
      // transfer BPT tokens to feesCollector
      const bptBalanceOfLiquidityProvider = await pool.balanceOf(liquidityProvider.address);
      await pool.connect(liquidityProvider).transfer(protocolFeesCollector.address, bptBalanceOfLiquidityProvider);

      await protocolFeeSplitter.collectFees(poolId);

      const poolOwnerBalance = await pool.balanceOf(poolOwner.address);
      const treasuryBalance = await pool.balanceOf(treasury.address);

      // pool owner should get 0, and treasury everything if fee is not defined
      expectEqualWithError(poolOwnerBalance, 0);
      expectEqualWithError(treasuryBalance, bptBalanceOfLiquidityProvider);
    });

    it('distributes collected BPT fees to pool beneficiary and treasury (fee percentage defined)', async () => {
      // set fee for a pool
      await protocolFeeSplitter.connect(admin).setRevenueSharingFeePercentage(poolId, bn(10e16)); // 10%

      // set pool beneficiary to own address
      await protocolFeeSplitter.connect(poolOwner).setPoolBeneficiary(poolId, poolOwner.address);

      // transfer BPT tokens to feesCollector
      const bptBalanceOfLiquidityProvider = await pool.balanceOf(liquidityProvider.address);
      await pool.connect(liquidityProvider).transfer(protocolFeesCollector.address, bptBalanceOfLiquidityProvider);

      await protocolFeeSplitter.collectFees(poolId);

      // 10% of bptBalanceOfLiquidityProvider should go to owner
      const poolOwnerExpectedBalance = bptBalanceOfLiquidityProvider.mul(bn(10e16)).div(bn(1e18));
      // 90% goes to treasury
      const treasuryExpectedBalance = bptBalanceOfLiquidityProvider.mul(bn(90e16)).div(bn(1e18));

      const poolOwnerBalance = await pool.balanceOf(poolOwner.address);
      const treasuryBalance = await pool.balanceOf(treasury.address);

      expectEqualWithError(poolOwnerBalance, poolOwnerExpectedBalance);
      expectEqualWithError(treasuryBalance, treasuryExpectedBalance);
    });

    it('distributes collected BPT fees to treasury (beneficiary is not set for a pool)', async () => {
      // We transfer LP's BPT token to collector
      // treasury should get everything because pool has no owner
      const bptBalanceOfLiquidityProvider = await pool.balanceOf(liquidityProvider.address);
      await pool.connect(liquidityProvider).transfer(protocolFeesCollector.address, bptBalanceOfLiquidityProvider);

      await protocolFeeSplitter.collectFees(poolId);

      const treasuryBalance = await pool.balanceOf(treasury.address);
      expectEqualWithError(treasuryBalance, bptBalanceOfLiquidityProvider);
    });
  });
});
