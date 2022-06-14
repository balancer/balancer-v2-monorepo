import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { expect } from 'chai';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { ANY_ADDRESS, MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';

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
  const distributor = ANY_ADDRESS;

  await assetManager.initialize(poolId, distributor);

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
      distributor,
    },
    contracts: {
      assetManager,
      lendingPool,
      tokens,
      stkAave: await Token.deployedAt(stkAave.address),
      pool,
      vault,
    },
  };
};

describe('Aave Asset manager', function () {
  let assetManager: Contract, stkAave: Token;
  let distributor: string;

  sharedBeforeEach('set up asset manager', async () => {
    const { data, contracts } = await setup();

    distributor = data.distributor;

    assetManager = contracts.assetManager;
    stkAave = contracts.stkAave;
  });

  describe('claimRewards', () => {
    const rewardAmount = fp(1);

    it('sends expected amount of stkAave to the rewards contract', async () => {
      const rewardsBefore = await stkAave.balanceOf(distributor);
      await assetManager.claimRewards();
      const rewardsAfter = await stkAave.balanceOf(distributor);
      expect(rewardsAfter).to.be.eq(rewardsBefore.add(rewardAmount));
    });
  });
});
