import { Contract } from 'ethers';

import * as expectEvent from '../../../test/expectEvent';
import { deploy, deployedAt } from '../../../contract';

import Vault from '../../vault/Vault';
import WeightedPool from './WeightedPool';
import VaultDeployer from '../../vault/VaultDeployer';
import TypesConverter from '../../types/TypesConverter';
import { RawWeightedPoolDeployment, WeightedPoolDeployment, WeightedPoolType } from './types';

const NAME = 'Balancer Pool Token';
const SYMBOL = 'BPT';

export default {
  async deploy(params: RawWeightedPoolDeployment): Promise<WeightedPool> {
    const deployment = TypesConverter.toWeightedPoolDeployment(params);
    const vault = params?.vault ?? (await VaultDeployer.deploy(TypesConverter.toRawVaultDeployment(params)));
    const pool = await (params.fromFactory ? this._deployFromFactory : this._deployStandalone)(deployment, vault);

    const {
      tokens,
      weights,
      assetManagers,
      swapFeePercentage,
      poolType,
      swapEnabledOnStart,
      managementSwapFeePercentage,
    } = deployment;

    const poolId = await pool.getPoolId();
    return new WeightedPool(
      pool,
      poolId,
      vault,
      tokens,
      weights,
      assetManagers,
      swapFeePercentage,
      poolType,
      swapEnabledOnStart,
      managementSwapFeePercentage
    );
  },

  async _deployStandalone(params: WeightedPoolDeployment, vault: Vault): Promise<Contract> {
    const {
      tokens,
      weights,
      assetManagers,
      swapFeePercentage,
      pauseWindowDuration,
      bufferPeriodDuration,
      oracleEnabled,
      poolType,
      swapEnabledOnStart,
      managementSwapFeePercentage,
      owner,
      from,
    } = params;

    let result: Promise<Contract>;

    switch (poolType) {
      case WeightedPoolType.WEIGHTED_POOL_2TOKENS: {
        result = deploy('v2-pool-weighted/MockWeightedPool2Tokens', {
          args: [
            {
              vault: vault.address,
              name: NAME,
              symbol: SYMBOL,
              token0: tokens.addresses[0],
              token1: tokens.addresses[1],
              normalizedWeight0: weights[0],
              normalizedWeight1: weights[1],
              swapFeePercentage: swapFeePercentage,
              pauseWindowDuration: pauseWindowDuration,
              bufferPeriodDuration: bufferPeriodDuration,
              oracleEnabled: oracleEnabled,
              owner: owner,
            },
          ],
          from,
          libraries: { QueryProcessor: (await deploy('QueryProcessor')).address },
        });
        break;
      }
      case WeightedPoolType.LIQUIDITY_BOOTSTRAPPING_POOL: {
        result = deploy('v2-pool-weighted/LiquidityBootstrappingPool', {
          args: [
            vault.address,
            NAME,
            SYMBOL,
            tokens.addresses,
            weights,
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner,
            swapEnabledOnStart,
          ],
          from,
        });
        break;
      }
      case WeightedPoolType.MANAGED_POOL: {
        result = deploy('v2-pool-weighted/ManagedPool', {
          args: [
            {
              vault: vault.address,
              name: NAME,
              symbol: SYMBOL,
              tokens: tokens.addresses,
              normalizedWeights: weights,
              swapFeePercentage: swapFeePercentage,
              assetManagers: assetManagers,
              pauseWindowDuration: pauseWindowDuration,
              bufferPeriodDuration: bufferPeriodDuration,
              owner: owner,
              swapEnabledOnStart: swapEnabledOnStart,
              managementSwapFeePercentage: managementSwapFeePercentage,
            },
          ],
          from,
        });
        break;
      }
      default: {
        result = deploy('v2-pool-weighted/WeightedPool', {
          args: [
            vault.address,
            NAME,
            SYMBOL,
            tokens.addresses,
            weights,
            assetManagers,
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner,
          ],
          from,
        });
      }
    }

    return result;
  },

  async _deployFromFactory(params: WeightedPoolDeployment, vault: Vault): Promise<Contract> {
    const {
      tokens,
      weights,
      assetManagers,
      swapFeePercentage,
      oracleEnabled,
      swapEnabledOnStart,
      managementSwapFeePercentage,
      poolType,
      owner,
      from,
    } = params;

    let result: Promise<Contract>;

    switch (poolType) {
      case WeightedPoolType.WEIGHTED_POOL_2TOKENS: {
        const factory = await deploy('v2-pool-weighted/WeightedPool2TokensFactory', {
          args: [vault.address],
          from,
          libraries: { QueryProcessor: await (await deploy('QueryProcessor')).address },
        });
        const tx = await factory.create(
          NAME,
          SYMBOL,
          tokens.addresses,
          weights,
          swapFeePercentage,
          oracleEnabled,
          owner
        );
        const receipt = await tx.wait();
        const event = expectEvent.inReceipt(receipt, 'PoolCreated');
        result = deployedAt('v2-pool-weighted/WeightedPool2Tokens', event.args.pool);
        break;
      }
      case WeightedPoolType.LIQUIDITY_BOOTSTRAPPING_POOL: {
        const factory = await deploy('v2-pool-weighted/LiquidityBootstrappingPoolFactory', {
          args: [vault.address],
          from,
        });
        const tx = await factory.create(
          NAME,
          SYMBOL,
          tokens.addresses,
          weights,
          swapFeePercentage,
          owner,
          swapEnabledOnStart
        );
        const receipt = await tx.wait();
        const event = expectEvent.inReceipt(receipt, 'PoolCreated');
        result = deployedAt('v2-pool-weighted/LiquidityBootstrappingPool', event.args.pool);
        break;
      }
      case WeightedPoolType.MANAGED_POOL: {
        const factory = await deploy('v2-pool-weighted/ManagedPoolFactory', {
          args: [vault.address],
          from,
        });
        const tx = await factory.create(
          NAME,
          SYMBOL,
          tokens.addresses,
          weights,
          swapFeePercentage,
          owner,
          swapEnabledOnStart,
          managementSwapFeePercentage
        );
        const receipt = await tx.wait();
        const event = expectEvent.inReceipt(receipt, 'PoolCreated');
        result = deployedAt('v2-pool-weighted/ManagedPool', event.args.pool);
        break;
      }
      default: {
        const factory = await deploy('v2-pool-weighted/WeightedPoolFactory', { args: [vault.address], from });
        const tx = await factory.create(
          NAME,
          SYMBOL,
          tokens.addresses,
          weights,
          assetManagers,
          swapFeePercentage,
          owner
        );
        const receipt = await tx.wait();
        const event = expectEvent.inReceipt(receipt, 'PoolCreated');
        result = deployedAt('v2-pool-weighted/WeightedPool', event.args.pool);
      }
    }

    return result;
  },
};
