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
import { random } from 'lodash';

const NAME = 'Balancer Pool Token';
const SYMBOL = 'BPT';
const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
const WEIGHTS = toNormalizedWeights([fp(30), fp(70), fp(5), fp(5)]);

describe.only('ProtocolFeeSplitter', function () {
  let vault: Vault;
  let factory: Contract;
  let protocolFeesCollector: Contract;
  let protocolFeeSplitter: Contract;
  let pool: Contract;

  let admin: SignerWithAddress,
    poolOwner: SignerWithAddress,
    treasury: SignerWithAddress,
    liquidityProvider: SignerWithAddress;
  let assetManagers: string[];
  let tokens: TokenList;
  let poolId: string;

  before(async () => {
    [, admin, poolOwner, liquidityProvider, treasury] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault & protocol fees collector', async () => {
    vault = await Vault.create({ admin });
    protocolFeesCollector = await vault.getFeesCollector();
  });

  sharedBeforeEach('deploy tokens, pool & gives initial liquditiy', async () => {
    tokens = await TokenList.create(['DAI', 'MKR', 'SNX', 'BAT'], { sorted: true });
    factory = await deploy('v2-pool-weighted/WeightedPoolFactory', { args: [vault.address] });
    assetManagers = Array(tokens.length).fill(ZERO_ADDRESS);
    pool = await createPool();
    poolId = await pool.getPoolId();

    const initialBalances = Array(tokens.length).fill(fp(1000));
    poolId = await pool.getPoolId();

    const request: JoinPoolRequest = {
      assets: tokens.addresses,
      maxAmountsIn: initialBalances,
      userData: WeightedPoolEncoder.joinInit(initialBalances),
      fromInternalBalance: false,
    };

    await tokens.mint({ to: liquidityProvider, amount: fp(10000 + random(1000)) });
    await tokens.approve({ from: liquidityProvider, to: vault });

    await vault.instance
      .connect(liquidityProvider)
      .joinPool(poolId, liquidityProvider.address, liquidityProvider.address, request);
  });

  sharedBeforeEach('deploy ProtocolFeeSplitter & grant permissions', async () => {
    protocolFeeSplitter = await deploy('ProtocolFeeSplitter', {
      args: [protocolFeesCollector.address, treasury.address],
    });

    const setRevenueSharingFeeRole = await actionId(protocolFeeSplitter, 'setRevenueSharingFeePercentage');
    await vault.grantPermissionsGlobally([setRevenueSharingFeeRole], admin);

    const withdrawCollectedFeesRole = await actionId(protocolFeesCollector, 'withdrawCollectedFees');
    await vault.grantPermissionsGlobally([withdrawCollectedFeesRole], protocolFeeSplitter);
  });

  async function createPool(): Promise<Contract> {
    const receipt = await (
      await factory.create(
        NAME,
        SYMBOL,
        tokens.addresses,
        WEIGHTS,
        assetManagers,
        POOL_SWAP_FEE_PERCENTAGE,
        poolOwner.address
      )
    ).wait();

    const event = expectEvent.inReceipt(receipt, 'PoolCreated');
    return deployedAt('v2-pool-weighted/WeightedPool', event.args.pool);
  }

  describe('constructor', () => {
    it('sets the protocolFeesCollector', async () => {
      expect(await protocolFeeSplitter.protocolFeesCollector()).to.be.eq(protocolFeesCollector.address);
    });
    it('sets the treasury', async () => {
      expect(await protocolFeeSplitter.treasury()).to.be.eq(treasury.address);
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
      ).to.be.revertedWith('BAL#700');
    });
  });

  describe('collect fees', async () => {
    it('reverts if no BPT collected', async () => {
      expect(await pool.balanceOf(protocolFeesCollector.address)).to.equal(0);
      await expect(protocolFeeSplitter.collectFees(poolId)).to.be.revertedWith('BAL#701');
    });

    it('distributes collected BPT fees to owner and treasury', async () => {
      // transfer BPT tokens to feesCollector
      const bptBalanceOfLiquidityProvider = await pool.balanceOf(liquidityProvider.address);
      await pool.connect(liquidityProvider).transfer(protocolFeesCollector.address, bptBalanceOfLiquidityProvider);

      await protocolFeeSplitter.collectFees(poolId);

      // TODO: do the math right
      expect(await pool.balanceOf(protocolFeesCollector.address)).to.equal(0);
      expect(await pool.balanceOf(poolOwner.address)).to.not.equal(0);
      expect(await pool.balanceOf(treasury.address)).to.not.equal(0);
    });
  });
});
