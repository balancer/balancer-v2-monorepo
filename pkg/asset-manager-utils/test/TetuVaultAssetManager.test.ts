import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { PoolSpecialization } from '@balancer-labs/balancer-js';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { encodeInvestmentConfig } from './helpers/rebalance';
import { encodeExit, encodeJoin } from '@balancer-labs/v2-helpers/src/models/pools/mockPool';
import {actionId} from "@balancer-labs/v2-helpers/src/models/misc/actions";

const tokenInitialBalance = bn(100e18);

const setup = async () => {
  const [, lp, other] = await ethers.getSigners();
  const tokens = await TokenList.create(['DAI', 'MKR'], { sorted: true });

  // Deploy Balancer Vault
  const vault = await Vault.create();
  const action = await actionId(vault.instance, 'setPoolActivated');
  await vault.grantPermissionsGlobally([action]);

  // Deploy mocked TetuVault
  const tetuVault = await deploy('MockSmartVault', { args: [tokens.get(0).address] });

  // Deploy mocked pool
  const pool = await deploy('v2-vault/MockSmartPool', {
    args: [vault.address, PoolSpecialization.GeneralPool],
  });
  const poolId = await pool.getPoolId();
  await vault.instance.setPoolActivated(poolId);

  // Deploy Asset manager
  const assetManager = await deploy('TetuVaultAssetManager', {
    args: [vault.address, tetuVault.address, tokens.get(0).address],
  });

  // Assign assetManager to the DAI token, and other to the other token
  const assetManagers = [assetManager.address, other.address];
  await assetManager.initialize(poolId);

  await tokens.mint({ to: lp, amount: tokenInitialBalance });
  await tokens.approve({ to: vault.address, from: [lp] });

  const assets = tokens.addresses;

  await pool.registerTokens(assets, assetManagers);

  const ud = encodeJoin(
    assets.map(() => 1000),
    assets.map(() => 0)
  );

  await vault.instance.connect(lp).joinPool(poolId, lp.address, lp.address, {
    assets: assets,
    maxAmountsIn: assets.map(() => MAX_UINT256),
    fromInternalBalance: false,
    userData: ud,
  });

  return {
    data: {
      poolId,
    },
    contracts: {
      assetManager,
      tokens,
      pool,
      vault,
    },
  };
};

describe('Tetu Asset manager', function () {
  let vault: Vault, assetManager: Contract, pool: Contract;
  let poolId: string;
  let lp: SignerWithAddress;
  let tokens: TokenList;

  before('deploy base contracts', async () => {
    [, lp] = await ethers.getSigners();
  });

  sharedBeforeEach('set up asset manager', async () => {
    const { contracts } = await setup();

    assetManager = contracts.assetManager;
    vault = contracts.vault;
    pool = contracts.pool;
    poolId = await pool.getPoolId();
    tokens = contracts.tokens;

    const config = {
      targetPercentage: fp(0.5),
      upperCriticalPercentage: fp(0.6),
      lowerCriticalPercentage: fp(0.4),
    };

    await pool.setAssetManagerPoolConfig(assetManager.address, encodeInvestmentConfig(config));
    await assetManager.rebalance(poolId, false);
    const vaultTokenInfo = await vault.getPoolTokens(poolId);
    // vault balance should be 1000 token each
    expect(vaultTokenInfo.balances[0]).to.be.eq(1000);
    expect(vaultTokenInfo.balances[1]).to.be.eq(1000);

    const [poolCash, poolManaged] = await assetManager.getPoolBalances(poolId);
    // asset manager should invest 50% of tokens according to targetPercentage
    expect(poolCash).to.be.eq(500);
    expect(poolManaged).to.be.eq(500);
  });

  describe('key path', () => {
    it('AM should NOT return error when withdraw more funds than in vault', async () => {
      const balBefore = await tokens.get(0).balanceOf(lp.address);
      const vaultTokenInfo = await vault.getPoolTokens(poolId);
      // we have 500 tokens available and AM should devest 100 from to be able to process this transaction
      await vault.instance.connect(lp).exitPool(poolId, lp.address, lp.address, {
        assets: vaultTokenInfo.tokens,
        minAmountsOut: Array(vaultTokenInfo.tokens.length).fill(0),
        toInternalBalance: false,
        userData: encodeExit([bn(600), bn(0)], Array(vaultTokenInfo.tokens.length).fill(0)),
      });

      const vaultTokenInfoAfter = await vault.getPoolTokens(poolId);
      // we should have 400 tokens in the vault after withdraw
      expect(vaultTokenInfoAfter.balances[0]).to.be.eq(400);
      expect(vaultTokenInfoAfter.balances[1]).to.be.eq(1000);

      const balAfter = await tokens.get(0).balanceOf(lp.address);
      // user should receive 600 tokens
      expect(balAfter.sub(balBefore)).to.be.eq(600);
    });
  });
});
