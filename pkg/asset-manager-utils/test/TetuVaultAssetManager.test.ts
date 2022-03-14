import {config, ethers, hardhatArguments} from 'hardhat';
import {Contract} from 'ethers';
import {expect} from 'chai';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import {bn, fp} from '@balancer-labs/v2-helpers/src/numbers';
import {MAX_UINT256} from '@balancer-labs/v2-helpers/src/constants';

import {deploy, deployedAt} from '@balancer-labs/v2-helpers/src/contract';
import {PoolSpecialization, WeightedPoolEncoder} from '@balancer-labs/balancer-js';
import {advanceTime} from '@balancer-labs/v2-helpers/src/time';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import {MultiDistributor} from '@balancer-labs/v2-helpers/src/models/distributor/MultiDistributor';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import {actionId} from '@balancer-labs/v2-helpers/src/models/misc/actions';
import {encodeInvestmentConfig} from "./helpers/rebalance";
import {ManagedPoolParams} from "@balancer-labs/v2-helpers/src/models/pools/weighted/types";
import * as expectEvent from "@balancer-labs/v2-helpers/src/test/expectEvent";
import {encodeExit, encodeJoin} from "@balancer-labs/v2-helpers/src/models/pools/mockPool";

const tokenInitialBalance = bn(100e18);

const setup = async () => {
  const [signer, lp, other] = await ethers.getSigners();
  const tokens = await TokenList.create(['DAI', 'MKR'], {sorted: true});

  // let c = config;
  // // c.networks.hardhat.gas = 50_000_000;
  // console.log(c);

  // Deploy Balancer Vault
  const vault = await Vault.create();

  // Deploy mocked TetuVault
  const tetuVault = await deploy('MockSmartVault', {args: [tokens.get(0).address]});


  // /Users/anatseuski/work/balancer-v2-monorepo/node_modules/@balancer-labs/v2-vault/contracts/test/MockSmartPool.sol

  // Deploy mocked pool
  const pool = await deploy('v2-vault/MockSmartPool', {
    args: [vault.address, PoolSpecialization.GeneralPool],
  });
  const poolId = await pool.getPoolId();
  console.log('poolId ', poolId);

  // Deploy Asset manager
  const assetManager = await deploy('TetuVaultAssetManager', {
    args: [vault.address, tetuVault.address, tokens.get(0).address],
  });

  console.log("AM addr: ", assetManager.address);

  // Assign assetManager to the DAI token, and other to the other token
  const assetManagers = [assetManager.address, other.address];
  await assetManager.initialize(poolId);

  await tokens.mint({to: lp, amount: tokenInitialBalance});
  await tokens.approve({to: vault.address, from: [lp]});

  const assets = tokens.addresses;
  console.log("assets ", assets);

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

  const config = {
    targetPercentage: fp(0.5),
    upperCriticalPercentage: fp(0.6),
    lowerCriticalPercentage: fp(0.4),
  };

  await pool.setAssetManagerPoolConfig(assetManager.address, encodeInvestmentConfig(config));
  await assetManager.rebalance(poolId, false);


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
  let vault: Vault, assetManager: Contract, distributor: MultiDistributor, pool: Contract, stkAave: Token;
  let poolId: string;
  let lp: SignerWithAddress, other: SignerWithAddress, admin: SignerWithAddress;

  before('deploy base contracts', async () => {
    const [signer, lp, other] = await ethers.getSigners();
  });

  sharedBeforeEach('set up asset manager', async () => {
    const {contracts} = await setup();

    assetManager = contracts.assetManager;
    vault = contracts.vault;
    pool = contracts.pool;
    poolId = await pool.getPoolId();
  });

  describe('key path', () => {
    // let id: string;
    // const rewardAmount = fp(1);

    // beforeEach(async () => {
    //
    // });

    // it('sends expected amount of stkAave to the rewards contract', async () => {
    //   const rewardsBefore = await vault.instance.getInternalBalance(distributor.address, [stkAave.address]);
    //   await assetManager.claimRewards();
    //   const rewardsAfter = await vault.instance.getInternalBalance(distributor.address, [stkAave.address]);
    //   expect(rewardsAfter[0]).to.be.eq(rewardsBefore[0].add(rewardAmount));
    // });
    //
    // it('distributes the reward according to the fraction of staked LP tokens', async () => {
    //   await assetManager.claimRewards();
    //   await advanceTime(10);
    //
    //   const expectedReward = fp(0.75);
    //   const actualReward = await distributor.getClaimableTokens(id, lp);
    //   expect(expectedReward.sub(actualReward).abs()).to.be.lte(100);
    // });

    // it('Go go go', async () => {
    //   console.log('todo!');
    // });

    it('AM should NOT return error when withdraw more funds than in vault', async () => {
      //todo fix
      const [signer, lp, other] = await ethers.getSigners();


      await assetManager.rebalance(poolId, false);
      // after re balance 50 usdc should be invested by AM and 50 usdc available in the vault

      // const balBefore = await TokenUtils.balanceOf(MaticAddresses.USDC_TOKEN, investor.address);
      // console.log("Bal before ", balBefore.toString());

      const vaultTokenInfo = await vault.getPoolTokens(poolId);

      console.log("vaultTokenInfo");
      console.log(vaultTokenInfo.balances[0].toString());
      console.log(vaultTokenInfo.balances[1].toString());


      const tx = await vault.instance.connect(lp).exitPool(poolId, lp.address, lp.address, {
        assets: vaultTokenInfo.tokens,
        minAmountsOut: Array(vaultTokenInfo.tokens.length).fill(0),
        toInternalBalance: false,
        userData: encodeExit([bn(600), bn(0)], Array(vaultTokenInfo.tokens.length).fill(0)),
      });

      //
      // const receipt = await tx.wait();
      // const gasUsed = receipt.gasUsed;
      // console.log("gasUsed ", gasUsed.toString());
      //


      const vaultTokenInfoAfter = await vault.getPoolTokens(poolId);

      console.log("vaultTokenInfoAfter");
      console.log(vaultTokenInfoAfter.balances[0].toString());
      console.log(vaultTokenInfoAfter.balances[1].toString());


    });


  });
});
