import { ethers } from 'hardhat';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { bn } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { GeneralPool } from '@balancer-labs/v2-helpers/src/models/vault/pools';
import { encodeJoin } from '@balancer-labs/v2-helpers/src/models/pools/mockPool';

export const tokenInitialBalance = bn(200e18);
export const amount = bn(100e18);

export const setup = async () => {
  const [, admin, lp, other] = await ethers.getSigners();

  const tokens = await TokenList.create(['DAI', 'MKR'], { sorted: true });

  // Deploy Balancer Vault
  const authorizer = await deploy('v2-vault/Authorizer', { args: [admin.address] });
  const vault = await deploy('v2-vault/Vault', { args: [authorizer.address, tokens.DAI.address, 0, 0] });

  // Deploy Asset manager
  const assetManager = await deploy('TestAssetManager', {
    args: [vault.address, tokens.DAI.address],
  });

  // Deploy Pool
  const pool = await deploy('v2-vault/test/MockPool', { args: [vault.address, GeneralPool] });
  const poolId = await pool.getPoolId();

  await tokens.mint({ to: lp, amount: tokenInitialBalance.mul(2) });
  await tokens.approve({ to: vault.address, from: [lp] });

  // Assign assetManager to the DAI token, and other to the other token
  const assetManagers = [assetManager.address, other.address];

  await pool.registerTokens(tokens.addresses, assetManagers);

  await vault.connect(lp).joinPool(poolId, lp.address, lp.address, {
    assets: tokens.addresses,
    maxAmountsIn: tokens.addresses.map(() => MAX_UINT256),
    fromInternalBalance: false,
    userData: encodeJoin(
      tokens.addresses.map(() => tokenInitialBalance),
      tokens.addresses.map(() => 0)
    ),
  });

  // Deploy Pool for liquidating fees
  const swapPool = await deploy('v2-vault/test/MockPool', { args: [vault.address, GeneralPool] });
  const swapPoolId = await swapPool.getPoolId();

  await swapPool.registerTokens(tokens.addresses, [ZERO_ADDRESS, ZERO_ADDRESS]);

  await vault.connect(lp).joinPool(swapPoolId, lp.address, lp.address, {
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
      swapPoolId,
    },
    contracts: {
      assetManager,
      tokens,
      vault,
    },
  };
};
