import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { encodeJoinWeightedPool, WeightedPoolJoinKind } from '@balancer-labs/balancerjs';

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
}

export const setup = async (): Promise<{ data: SetupData; contracts: SetupContracts }> => {
  const [, admin, lp, mockAssetManager] = await ethers.getSigners();

  const tokens = await TokenList.create(['SNX', 'MKR'], { sorted: true });
  const rewardTokens = await TokenList.create(['DAI'], { sorted: true });

  // Deploy Balancer Vault
  const vaultHelper = await Vault.create({ admin });
  const vault = vaultHelper.instance;
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

  await tokens.mint({ to: lp, amount: tokenInitialBalance });
  await tokens.approve({ to: vault.address, from: [lp] });

  await rewardTokens.mint({ to: mockAssetManager, amount: rewardTokenInitialBalance });
  await rewardTokens.approve({ to: stakingContract.address, from: [mockAssetManager] });

  const assets = tokens.addresses;

  await vault.connect(lp).joinPool(poolId, lp.address, lp.address, {
    assets,
    maxAmountsIn: Array(assets.length).fill(MAX_UINT256),
    fromInternalBalance: false,
    userData: encodeJoinWeightedPool({
      kind: WeightedPoolJoinKind.INIT,
      amountsIn: Array(assets.length).fill(tokenInitialBalance),
    }),
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
    },
  };
};
