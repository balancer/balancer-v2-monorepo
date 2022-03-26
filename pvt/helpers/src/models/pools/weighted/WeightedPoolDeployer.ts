import { Contract } from 'ethers';

import * as expectEvent from '../../../test/expectEvent';
import { deploy, deployedAt } from '../../../contract';

import Vault from '../../vault/Vault';
import WeightedPool from './WeightedPool';
import VaultDeployer from '../../vault/VaultDeployer';
import TypesConverter from '../../types/TypesConverter';
import {
  BasePoolRights,
  ManagedPoolParams,
  ManagedPoolRights,
  RawWeightedPoolDeployment,
  WeightedPoolDeployment,
  WeightedPoolType,
} from './types';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { DAY } from '@balancer-labs/v2-helpers/src/time';

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
      mustAllowlistLPs,
      protocolSwapFeePercentage,
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
      mustAllowlistLPs,
      protocolSwapFeePercentage,
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
      mustAllowlistLPs,
      protocolSwapFeePercentage,
      managementSwapFeePercentage,
      owner,
      from,
    } = params;

    let result: Promise<Contract>;

    switch (poolType) {
      case WeightedPoolType.ORACLE_WEIGHTED_POOL: {
        result = deploy('v2-pool-weighted/MockOracleWeightedPool', {
          args: [
            {
              vault: vault.address,
              name: NAME,
              symbol: SYMBOL,
              tokens: tokens.addresses,
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
            TypesConverter.toAddress(owner),
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
              name: NAME,
              symbol: SYMBOL,
              tokens: tokens.addresses,
              normalizedWeights: weights,
              swapFeePercentage: swapFeePercentage,
              assetManagers: assetManagers,
              swapEnabledOnStart: swapEnabledOnStart,
              mustAllowlistLPs: mustAllowlistLPs,
              protocolSwapFeePercentage: protocolSwapFeePercentage,
              managementSwapFeePercentage: managementSwapFeePercentage,
            },
            vault.address,
            owner,
            pauseWindowDuration,
            bufferPeriodDuration,
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
      mustAllowlistLPs,
      protocolSwapFeePercentage,
      managementSwapFeePercentage,
      poolType,
      owner,
      from,
    } = params;

    let result: Promise<Contract>;

    switch (poolType) {
      case WeightedPoolType.ORACLE_WEIGHTED_POOL: {
        const factory = await deploy('v2-pool-weighted/OracleWeightedPoolFactory', {
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
        result = deployedAt('v2-pool-weighted/OracleWeightedPool', event.args.pool);
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
        const baseFactory = await deploy('v2-pool-weighted/BaseManagedPoolFactory', {
          args: [vault.address],
          from,
        });

        const factory = await deploy('v2-pool-weighted/ManagedPoolFactory', {
          args: [baseFactory.address],
          from,
        });

        const newPoolParams: ManagedPoolParams = {
          name: NAME,
          symbol: SYMBOL,
          tokens: tokens.addresses,
          normalizedWeights: weights,
          assetManagers: Array(tokens.length).fill(ZERO_ADDRESS),
          swapFeePercentage: swapFeePercentage,
          swapEnabledOnStart: swapEnabledOnStart,
          mustAllowlistLPs: mustAllowlistLPs,
          protocolSwapFeePercentage: protocolSwapFeePercentage,
          managementSwapFeePercentage: managementSwapFeePercentage,
        };

        const basePoolRights: BasePoolRights = {
          canTransferOwnership: true,
          canChangeSwapFee: true,
          canUpdateMetadata: true,
        };

        const managedPoolRights: ManagedPoolRights = {
          canChangeWeights: true,
          canDisableSwaps: true,
          canSetMustAllowlistLPs: true,
          canSetCircuitBreakers: true,
          canChangeTokens: true,
          canChangeMgmtFees: true,
        };

        const tx = await factory
          .connect(from || ZERO_ADDRESS)
          .create(newPoolParams, basePoolRights, managedPoolRights, DAY, from?.address || ZERO_ADDRESS);
        const receipt = await tx.wait();
        const event = expectEvent.inReceipt(receipt, 'ManagedPoolCreated');
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
