import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

export const tokenInitialBalance = bn(200e18);
export const rewardTokenInitialBalance = bn(100e18);
export const rewardsDuration = 1; // Have a neglibile duration so that rewards are distributed instantaneously

interface SetupData {
  poolId: string;
}

interface SetupContracts {
  rewardTokens: TokenList;
  pool: Contract;
  stakingContract: Contract;
  vault: Contract;
  authorizer: Contract;
}

export const setup = async (): Promise<{ data: SetupData; contracts: SetupContracts }> => {
  const [, admin, lp, mockAssetManager] = await ethers.getSigners();

  const tokens = await TokenList.create(['SNX', 'MKR'], { sorted: true });
  const rewardTokens = await TokenList.create(['DAI'], { sorted: true });

  // Deploy Balancer Vault
  const authorizer = await deploy('v2-vault/Authorizer', { args: [admin.address] });

  const vault = await deploy('v2-vault/Vault', { args: [authorizer.address, ZERO_ADDRESS, 0, 0] });

  const assetManagers = Array(tokens.length).fill(mockAssetManager.address);

  const pool = await deploy('v2-pool-weighted/WeightedPool', {
    args: [
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
    ],
  });

  const poolId = await pool.getPoolId();

  // Deploy staking contract for pool
  const stakingContract = await deploy('MultiRewards', {
    args: [vault.address],
  });

  // authorize vault authorizer to allowlistRewarders
  const action = await actionId(stakingContract, 'allowlistRewarder');
  await authorizer.connect(admin).grantRole(action, admin.address);

  await tokens.mint({ to: lp, amount: tokenInitialBalance });
  await tokens.approve({ to: vault.address, from: [lp] });

  await rewardTokens.mint({ to: mockAssetManager, amount: rewardTokenInitialBalance });
  await rewardTokens.approve({ to: stakingContract.address, from: [mockAssetManager] });

  const assets = tokens.addresses;

  await vault.connect(lp).joinPool(poolId, lp.address, lp.address, {
    assets,
    maxAmountsIn: Array(assets.length).fill(MAX_UINT256),
    fromInternalBalance: false,
    userData: WeightedPoolEncoder.joinInit(Array(assets.length).fill(tokenInitialBalance)),
  });

  return {
    data: {
      poolId,
    },
    contracts: {
      rewardTokens,
      pool,
      stakingContract,
      vault,
      authorizer,
    },
  };
};
