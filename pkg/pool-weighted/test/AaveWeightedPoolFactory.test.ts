import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';

import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { toNormalizedWeights } from '@balancer-labs/v2-helpers/src/models/pools/weighted/misc';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

describe('AaveWeightedPoolFactory', function () {
  let tokens: TokenList;
  let baseFactory: Contract;
  let factory: Contract;
  let vault: Vault;
  let aaveRewardsController: Contract;
  let owner: SignerWithAddress;

  const NAME = 'Balancer Pool Token';
  const SYMBOL = 'BPT';
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const WEIGHTS = toNormalizedWeights([fp(30), fp(70), fp(5), fp(5)]);

  before('setup signers', async () => {
    [, owner] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy factory & tokens', async () => {
    tokens = await TokenList.create(['MKR', 'DAI', 'SNX', 'BAT'], { sorted: true });

    // Deploy mocked Aave
    const lendingPool = await deploy('v2-asset-manager-utils/MockAaveLendingPool', { args: [] });
    aaveRewardsController = await deploy('v2-asset-manager-utils/MockAaveRewards');

    const mkrAToken = await deploy('v2-asset-manager-utils/MockAToken', {
      args: [lendingPool.address, 'aMKR', 'aMKR', 18],
    });
    await lendingPool.registerAToken(tokens.MKR.address, mkrAToken.address);
    const daiAToken = await deploy('v2-asset-manager-utils/MockAToken', {
      args: [lendingPool.address, 'aDAI', 'aDAI', 18],
    });
    await lendingPool.registerAToken(tokens.DAI.address, daiAToken.address);

    vault = await Vault.create();

    baseFactory = await deploy('WeightedPoolFactory', { args: [vault.address] });

    factory = await deploy('AaveWeightedPoolFactory', { args: [baseFactory.address, lendingPool.address] });
  });

  async function createPool(managedTokens: number[] = []): Promise<Contract> {
    const receipt = await (
      await factory.create(
        NAME,
        SYMBOL,
        tokens.addresses,
        WEIGHTS,
        managedTokens,
        POOL_SWAP_FEE_PERCENTAGE,
        owner.address,
        aaveRewardsController.address,
        ZERO_ADDRESS
      )
    ).wait();

    const event = expectEvent.inIndirectReceipt(receipt, baseFactory.interface, 'PoolCreated');
    return deployedAt('WeightedPool', event.args.pool);
  }

  describe('constructor arguments', () => {
    let pool: Contract;

    sharedBeforeEach(async () => {
      pool = await createPool();
    });

    it('sets the vault', async () => {
      expect(await pool.getVault()).to.equal(vault.address);
    });

    it('registers tokens in the vault', async () => {
      const poolId = await pool.getPoolId();
      const poolTokens = await vault.getPoolTokens(poolId);

      expect(poolTokens.tokens).to.have.members(tokens.addresses);
      expect(poolTokens.balances).to.be.zeros;
    });

    it('starts with no BPT', async () => {
      expect(await pool.totalSupply()).to.be.equal(0);
    });

    it('sets swap fee', async () => {
      expect(await pool.getSwapFeePercentage()).to.equal(POOL_SWAP_FEE_PERCENTAGE);
    });

    it('sets the owner ', async () => {
      expect(await pool.getOwner()).to.equal(owner.address);
    });

    it('reverts on zero address being passed as owner ', async () => {
      await expect(
        factory.create(
          NAME,
          SYMBOL,
          tokens.addresses,
          WEIGHTS,
          [],
          POOL_SWAP_FEE_PERCENTAGE,
          ZERO_ADDRESS,
          aaveRewardsController.address,
          ZERO_ADDRESS
        )
      ).to.be.revertedWith('Pool must have owner');
    });

    it('sets the name', async () => {
      expect(await pool.name()).to.equal('Balancer Pool Token');
    });

    it('sets the symbol', async () => {
      expect(await pool.symbol()).to.equal('BPT');
    });

    it('sets the decimals', async () => {
      expect(await pool.decimals()).to.equal(18);
    });
  });

  describe('asset managers', () => {
    it('deploys asset managers for each managed token', async () => {
      const managedTokenIndices = [0];
      const pool = await createPool(managedTokenIndices);
      const poolId = await pool.getPoolId();

      for (let i = 0; i < tokens.length; i++) {
        const { assetManager } = await vault.getPoolTokenInfo(poolId, tokens.get(i));
        const expectAssetManagerDeployed = managedTokenIndices.includes(i);
        const assetManagerDeployed = assetManager !== ZERO_ADDRESS;
        expect(assetManagerDeployed).to.be.eq(expectAssetManagerDeployed);
      }
    });

    it('asset managers are initialised with correct pool id', async () => {
      const managedTokenIndices = [0];
      const pool = await createPool(managedTokenIndices);
      const poolId = await pool.getPoolId();

      for (let i = 0; i < managedTokenIndices.length; i++) {
        const token = tokens.get(managedTokenIndices[i]);
        const { assetManager } = await vault.getPoolTokenInfo(poolId, token);
        const manager = await deployedAt('v2-asset-manager-utils/AaveATokenAssetManager', assetManager);
        expect(await manager.poolId()).to.be.eq(poolId);
      }
    });
  });
});
