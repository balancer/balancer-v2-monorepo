import { Contract } from 'ethers';

import * as expectEvent from '../../../test/expectEvent';
import { deploy, deployedAt } from '../../../contract';

import Vault from '../../vault/Vault';
import WeightedPool from './WeightedPool';
import VaultDeployer from '../../vault/VaultDeployer';
import TypesConverter from '../../types/TypesConverter';
import { ManagedPoolParams, RawWeightedPoolDeployment, WeightedPoolDeployment, WeightedPoolType } from './types';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { ProtocolFee } from '../../vault/types';
import { MONTH } from '../../../time';

const NAME = 'Balancer Pool Token';
const SYMBOL = 'BPT';

export default {
  async deploy(params: RawWeightedPoolDeployment): Promise<WeightedPool> {
    const deployment = TypesConverter.toWeightedPoolDeployment(params);
    const vault = params?.vault ?? (await VaultDeployer.deploy(TypesConverter.toRawVaultDeployment(params)));
    const pool = await (params.fromFactory ? this._deployFromFactory : this._deployStandalone)(deployment, vault);
    const poolId = await pool.getPoolId();

    const {
      tokens,
      weights,
      rateProviders,
      assetManagers,
      swapFeePercentage,
      poolType,
      swapEnabledOnStart,
      mustAllowlistLPs,
      managementAumFeePercentage,
      aumProtocolFeesCollector,
      poolVersion,
    } = deployment;

    return new WeightedPool(
      pool,
      poolId,
      vault,
      tokens,
      weights,
      TypesConverter.toAddresses(rateProviders),
      assetManagers,
      swapFeePercentage,
      poolType,
      swapEnabledOnStart,
      mustAllowlistLPs,
      managementAumFeePercentage,
      aumProtocolFeesCollector,
      poolVersion
    );
  },

  async _deployStandalone(params: WeightedPoolDeployment, vault: Vault): Promise<Contract> {
    const {
      tokens,
      weights,
      rateProviders,
      assetManagers,
      swapFeePercentage,
      pauseWindowDuration,
      bufferPeriodDuration,
      poolType,
      swapEnabledOnStart,
      mustAllowlistLPs,
      managementAumFeePercentage,
      aumProtocolFeesCollector,
      owner,
      from,
      aumFeeId,
      poolVersion,
    } = params;

    let result: Promise<Contract>;

    switch (poolType) {
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
        const addRemoveTokenLib = await deploy('v2-pool-weighted/ManagedPoolAddRemoveTokenLib');
        const math = await deploy('v2-pool-weighted/ExternalWeightedMath');
        const circuitBreakerLib = await deploy('v2-pool-weighted/CircuitBreakerLib');
        result = deploy('v2-pool-weighted/ManagedPool', {
          args: [
            {
              name: NAME,
              symbol: SYMBOL,
              assetManagers: assetManagers,
            },
            {
              vault: vault.address,
              protocolFeeProvider: vault.protocolFeesProvider.address,
              weightedMath: math.address,
              pauseWindowDuration,
              bufferPeriodDuration,
              version: poolVersion,
            },
            {
              tokens: tokens.addresses,
              normalizedWeights: weights,
              swapFeePercentage: swapFeePercentage,
              swapEnabledOnStart: swapEnabledOnStart,
              mustAllowlistLPs: mustAllowlistLPs,
              managementAumFeePercentage: managementAumFeePercentage,
              aumProtocolFeesCollector: aumProtocolFeesCollector,
              aumFeeId: aumFeeId,
            },
            owner,
          ],
          from,
          libraries: {
            CircuitBreakerLib: circuitBreakerLib.address,
            ManagedPoolAddRemoveTokenLib: addRemoveTokenLib.address,
          },
        });
        break;
      }
      case WeightedPoolType.MOCK_MANAGED_POOL: {
        const addRemoveTokenLib = await deploy('v2-pool-weighted/ManagedPoolAddRemoveTokenLib');

        const math = await deploy('v2-pool-weighted/ExternalWeightedMath');
        const circuitBreakerLib = await deploy('v2-pool-weighted/CircuitBreakerLib');
        result = deploy('v2-pool-weighted/MockManagedPool', {
          args: [
            {
              name: NAME,
              symbol: SYMBOL,
              assetManagers: assetManagers,
            },
            {
              vault: vault.address,
              protocolFeeProvider: vault.protocolFeesProvider.address,
              weightedMath: math.address,
              pauseWindowDuration,
              bufferPeriodDuration,
              version: poolVersion,
            },
            {
              tokens: tokens.addresses,
              normalizedWeights: weights,
              swapFeePercentage: swapFeePercentage,
              swapEnabledOnStart: swapEnabledOnStart,
              mustAllowlistLPs: mustAllowlistLPs,
              managementAumFeePercentage: managementAumFeePercentage,
              aumProtocolFeesCollector: aumProtocolFeesCollector,
              aumFeeId: aumFeeId,
            },
            owner,
          ],
          from,
          libraries: {
            CircuitBreakerLib: circuitBreakerLib.address,
            ManagedPoolAddRemoveTokenLib: addRemoveTokenLib.address,
          },
        });
        break;
      }
      case WeightedPoolType.MOCK_MANAGED_POOL_SETTINGS: {
        const addRemoveTokenLib = await deploy('v2-pool-weighted/ManagedPoolAddRemoveTokenLib');

        const math = await deploy('v2-pool-weighted/ExternalWeightedMath');
        const circuitBreakerLib = await deploy('v2-pool-weighted/CircuitBreakerLib');
        result = deploy('v2-pool-weighted/MockManagedPoolSettings', {
          args: [
            {
              tokens: tokens.addresses,
              normalizedWeights: weights,
              swapFeePercentage: swapFeePercentage,
              swapEnabledOnStart: swapEnabledOnStart,
              mustAllowlistLPs: mustAllowlistLPs,
              managementAumFeePercentage: managementAumFeePercentage,
              aumProtocolFeesCollector: aumProtocolFeesCollector,
              aumFeeId: aumFeeId,
            },
            vault.address,
            vault.protocolFeesProvider.address,
            math.address,
            assetManagers,
            owner,
          ],
          from,
          libraries: {
            CircuitBreakerLib: circuitBreakerLib.address,
            ManagedPoolAddRemoveTokenLib: addRemoveTokenLib.address,
          },
        });
        break;
      }
      default: {
        result = deploy('v2-pool-weighted/WeightedPool', {
          args: [
            {
              name: NAME,
              symbol: SYMBOL,
              tokens: tokens.addresses,
              normalizedWeights: weights,
              rateProviders: rateProviders,
              assetManagers: assetManagers,
              swapFeePercentage: swapFeePercentage,
            },
            vault.address,
            vault.protocolFeesProvider.address,
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
    // Note that we only support asset managers with the standalone deploy method.
    const {
      tokens,
      weights,
      rateProviders,
      assetManagers,
      swapFeePercentage,
      swapEnabledOnStart,
      mustAllowlistLPs,
      managementAumFeePercentage,
      poolType,
      owner,
      from,
      aumFeeId,
      factoryVersion,
      poolVersion,
    } = params;

    let result: Promise<Contract>;
    const BASE_PAUSE_WINDOW_DURATION = MONTH * 3;
    const BASE_BUFFER_PERIOD_DURATION = MONTH;

    switch (poolType) {
      case WeightedPoolType.LIQUIDITY_BOOTSTRAPPING_POOL: {
        const factory = await deploy('v2-pool-weighted/LiquidityBootstrappingPoolFactory', {
          args: [
            vault.address,
            vault.getFeesProvider().address,
            BASE_PAUSE_WINDOW_DURATION,
            BASE_BUFFER_PERIOD_DURATION,
          ],
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
        const MANAGED_PAUSE_WINDOW_DURATION = MONTH * 9;
        const MANAGED_BUFFER_PERIOD_DURATION = MONTH * 2;

        const addRemoveTokenLib = await deploy('v2-pool-weighted/ManagedPoolAddRemoveTokenLib');
        const circuitBreakerLib = await deploy('v2-pool-weighted/CircuitBreakerLib');
        const factory = await deploy('v2-pool-weighted/ManagedPoolFactory', {
          args: [
            vault.address,
            vault.getFeesProvider().address,
            factoryVersion,
            poolVersion,
            MANAGED_PAUSE_WINDOW_DURATION,
            MANAGED_BUFFER_PERIOD_DURATION,
          ],
          from,
          libraries: {
            CircuitBreakerLib: circuitBreakerLib.address,
            ManagedPoolAddRemoveTokenLib: addRemoveTokenLib.address,
          },
        });

        const poolParams = {
          name: NAME,
          symbol: SYMBOL,
          assetManagers,
        };

        const settingsParams: ManagedPoolParams = {
          tokens: tokens.addresses,
          normalizedWeights: weights,
          swapFeePercentage: swapFeePercentage,
          swapEnabledOnStart: swapEnabledOnStart,
          mustAllowlistLPs: mustAllowlistLPs,
          managementAumFeePercentage: managementAumFeePercentage,
          aumFeeId: aumFeeId ?? ProtocolFee.AUM,
        };

        const tx = await factory
          .connect(from || ZERO_ADDRESS)
          .create(poolParams, settingsParams, from?.address || ZERO_ADDRESS);
        const receipt = await tx.wait();
        const event = expectEvent.inReceipt(receipt, 'ManagedPoolCreated');

        result = deployedAt('v2-pool-weighted/ManagedPool', event.args.pool);
        break;
      }
      case WeightedPoolType.MOCK_MANAGED_POOL: {
        throw new Error('Mock type not supported to deploy from factory');
      }
      default: {
        const factory = await deploy('v2-pool-weighted/WeightedPoolFactory', {
          args: [
            vault.address,
            vault.getFeesProvider().address,
            BASE_PAUSE_WINDOW_DURATION,
            BASE_BUFFER_PERIOD_DURATION,
          ],
          from,
        });
        const tx = await factory.create(
          NAME,
          SYMBOL,
          tokens.addresses,
          weights,
          rateProviders,
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
