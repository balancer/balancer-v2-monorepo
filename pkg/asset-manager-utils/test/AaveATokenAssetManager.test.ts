import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import { advanceTime } from '@balancer-labs/v2-helpers/src/time';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { MultiDistributor } from '@balancer-labs/v2-helpers/src/models/distributor/MultiDistributor';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

const tokenInitialBalance = bn(200e18);

const setup = async () => {
  const [, admin, lp, other] = await ethers.getSigners();

  const tokens = await TokenList.create(['DAI', 'MKR'], { sorted: true });

  // Deploy Balancer Vault
  const vault = await Vault.create({ admin });

  // Deploy mocked Aave
  const lendingPool = await deploy('MockAaveLendingPool', { args: [] });
  const aaveRewardsController = await deploy('MockAaveRewards');
  const stkAave = aaveRewardsController;

  const daiAToken = await deploy('MockAToken', { args: [lendingPool.address, 'aDai', 'aDai', 18] });
  await lendingPool.registerAToken(tokens.DAI.address, daiAToken.address);

  // Deploy Asset manager
  const assetManager = await deploy('AaveATokenAssetManager', {
    args: [vault.address, tokens.DAI.address, lendingPool.address, aaveRewardsController.address],
  });

  // Assign assetManager to the DAI token, and other to the other token
  const assetManagers = [assetManager.address, other.address];

  // Deploy Pool
  const args = [
    vault.address,
    'Test Pool',
    'TEST',
    tokens.addresses,
    [fp(0.5), fp(0.5)],
    assetManagers,
    fp(0.0001),
    0,
    0,
    admin.address,
  ];

  const pool = await deploy('v2-pool-weighted/WeightedPool', {
    args,
  });
  const poolId = await pool.getPoolId();

  // Deploy staking contract for pool
  const distributor = await MultiDistributor.create(vault);

  // Authorise distributor to use users' vault token approvals
  const action = await actionId(vault.instance, 'manageUserBalance');
  await vault.grantPermissionsGlobally([action], distributor);

  await vault.setRelayerApproval(lp, distributor, true);

  await assetManager.initialize(poolId, distributor.address);

  await tokens.mint({ to: lp, amount: tokenInitialBalance });
  await tokens.approve({ to: vault.address, from: [lp] });

  const assets = tokens.addresses;
  await vault.instance.connect(lp).joinPool(poolId, lp.address, lp.address, {
    assets: tokens.addresses,
    maxAmountsIn: Array(assets.length).fill(MAX_UINT256),
    fromInternalBalance: false,
    userData: WeightedPoolEncoder.joinInit(Array(assets.length).fill(tokenInitialBalance)),
  });

  return {
    data: {
      poolId,
    },
    contracts: {
      assetManager,
      distributor,
      lendingPool,
      tokens,
      stkAave: await Token.deployedAt(stkAave.address),
      pool,
      vault,
    },
  };
};

describe('Aave Asset manager', function () {
  let vault: Vault, assetManager: Contract, distributor: MultiDistributor, pool: Contract, stkAave: Token;

  let lp: SignerWithAddress, other: SignerWithAddress;

  before('deploy base contracts', async () => {
    [, , lp, other] = await ethers.getSigners();
  });

  sharedBeforeEach('set up asset manager', async () => {
    const { contracts } = await setup();

    assetManager = contracts.assetManager;
    vault = contracts.vault;
    pool = contracts.pool;
    distributor = contracts.distributor;
    stkAave = contracts.stkAave;
  });

  describe('claimRewards', () => {
    let id: string;
    const rewardAmount = fp(1);

    beforeEach(async () => {
      const bpt = await Token.deployedAt(pool.address);
      const bptBalance = await bpt.balanceOf(lp);

      await pool.connect(lp).approve(distributor.address, bptBalance);

      id = await distributor.getDistributionId(bpt, stkAave, assetManager.address);

      await distributor.subscribe(id, { from: lp });
      await distributor.stake(bpt, bptBalance.mul(3).div(4), lp, lp, { from: lp });

      // Stake half of the BPT to another address
      await distributor.subscribe(id, { from: other });
      await distributor.stake(bpt, bptBalance.div(4), lp, other, { from: lp });
    });

    it('sends expected amount of stkAave to the rewards contract', async () => {
      const rewardsBefore = await vault.instance.getInternalBalance(distributor.address, [stkAave.address]);
      await assetManager.claimRewards();
      const rewardsAfter = await vault.instance.getInternalBalance(distributor.address, [stkAave.address]);
      expect(rewardsAfter[0]).to.be.eq(rewardsBefore[0].add(rewardAmount));
    });

    it('distributes the reward according to the fraction of staked LP tokens', async () => {
      await assetManager.claimRewards();
      await advanceTime(10);

      const expectedReward = fp(0.75);
      const actualReward = await distributor.getClaimableTokens(id, lp);
      expect(expectedReward.sub(actualReward).abs()).to.be.lte(100);
    });
  });
});
