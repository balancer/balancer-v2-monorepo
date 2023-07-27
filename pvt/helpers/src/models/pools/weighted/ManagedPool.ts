import { BigNumber, Contract, ContractTransaction } from 'ethers';
import TypesConverter from '../../types/TypesConverter';
import VaultDeployer from '../../vault/VaultDeployer';
import WeightedPool from './WeightedPool';
import { BUFFER_PERIOD_DURATION, NAME, PAUSE_WINDOW_DURATION, SYMBOL } from '../base/BasePool';
import {
  RawManagedPoolDeployment,
  ManagedPoolDeployment,
  ManagedPoolParams,
  GradualSwapFeeUpdateParams,
  CircuitBreakerState,
  ManagedPoolType,
  ManagedPoolSettingsParams,
} from './types';
import Vault from '../../vault/Vault';
import { deploy, deployedAt } from '../../../contract';
import * as expectEvent from '../../../test/expectEvent';
import { Account } from '../../types/types';
import TokenList from '../../tokens/TokenList';
import { BigNumberish } from '../../../numbers';
import { ProtocolFee } from '../../vault/types';
import { ZERO_ADDRESS } from '../../../constants';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import Token from '../../tokens/Token';
import { accountToAddress } from '@balancer-labs/balancer-js';
import { randomBytes } from 'ethers/lib/utils';

export default class ManagedPool extends WeightedPool {
  static weightedMathLib: Contract;
  static addRemoveTokenLib: Contract;
  static circuitBreakerLib: Contract;
  static recoverModeHelperLib: Contract;
  static ammLib: Contract;

  swapEnabledOnStart: boolean;
  mustAllowlistLPs: boolean;
  managementAumFeePercentage: BigNumberish;
  aumFeeId: BigNumberish;
  poolVersion: string;

  constructor(
    instance: Contract,
    poolId: string,
    vault: Vault,
    tokens: TokenList,
    weights: BigNumberish[],
    assetManagers: string[],
    swapFeePercentage: BigNumberish,
    swapEnabledOnStart: boolean,
    mustAllowlistLPs: boolean,
    managementAumFeePercentage: BigNumberish,
    poolVersion: string,
    aumFeeId?: BigNumberish,
    owner?: Account
  ) {
    const rateProviders = Array(tokens.length).fill(ZERO_ADDRESS);
    super(instance, poolId, vault, tokens, weights, rateProviders, assetManagers, swapFeePercentage, owner);

    this.swapEnabledOnStart = swapEnabledOnStart;
    this.mustAllowlistLPs = mustAllowlistLPs;
    this.managementAumFeePercentage = managementAumFeePercentage;
    this.aumFeeId = aumFeeId ?? ProtocolFee.AUM;
    this.poolVersion = poolVersion;
  }

  static async create(params: RawManagedPoolDeployment = {}): Promise<ManagedPool> {
    const vault = params?.vault ?? (await VaultDeployer.deploy(TypesConverter.toRawVaultDeployment(params)));
    const deployment = TypesConverter.toManagedPoolDeployment(params);

    ManagedPool.weightedMathLib = await deploy('v2-pool-weighted/ExternalWeightedMath');
    ManagedPool.addRemoveTokenLib = await deploy('v2-pool-weighted/ManagedPoolAddRemoveTokenLib');
    ManagedPool.circuitBreakerLib = await deploy('v2-pool-weighted/CircuitBreakerLib');
    ManagedPool.recoverModeHelperLib = await deploy('v2-pool-utils/RecoveryModeHelper', { args: [vault.address] });
    ManagedPool.ammLib = await deploy('v2-pool-weighted/ManagedPoolAmmLib', {
      libraries: {
        CircuitBreakerLib: ManagedPool.circuitBreakerLib.address,
      },
    });

    const pool = await (params.fromFactory ? this._deployFromFactory : this._deployStandalone)(deployment, vault);
    const poolId = await pool.getPoolId();

    const {
      tokens,
      weights,
      assetManagers,
      swapFeePercentage,
      swapEnabledOnStart,
      mustAllowlistLPs,
      managementAumFeePercentage,
      poolVersion,
      aumFeeId,
      owner,
    } = deployment;

    return new ManagedPool(
      pool,
      poolId,
      vault,
      tokens,
      weights,
      assetManagers,
      swapFeePercentage,
      swapEnabledOnStart,
      mustAllowlistLPs,
      managementAumFeePercentage,
      poolVersion,
      aumFeeId,
      owner
    );
  }

  static async _deployStandalone(params: ManagedPoolDeployment, vault: Vault): Promise<Contract> {
    const {
      tokens,
      weights,
      assetManagers,
      swapFeePercentage,
      pauseWindowDuration,
      bufferPeriodDuration,
      swapEnabledOnStart,
      mustAllowlistLPs,
      managementAumFeePercentage,
      owner,
      poolType,
      from,
      aumFeeId,
      poolVersion,
    } = params;

    if (poolType == ManagedPoolType.MOCK_MANAGED_POOL_SETTINGS) {
      return deploy('v2-pool-weighted/MockManagedPoolSettings', {
        args: [
          {
            tokens: tokens.addresses,
            normalizedWeights: weights,
            swapFeePercentage: swapFeePercentage,
            swapEnabledOnStart: swapEnabledOnStart,
            mustAllowlistLPs: mustAllowlistLPs,
            managementAumFeePercentage: managementAumFeePercentage,
            aumFeeId: aumFeeId,
          },
          vault.address,
          vault.protocolFeesProvider.address,
          ManagedPool.weightedMathLib.address,
          ManagedPool.recoverModeHelperLib.address,
          assetManagers,
          owner,
        ],
        from,
        libraries: {
          CircuitBreakerLib: ManagedPool.circuitBreakerLib.address,
          ManagedPoolAddRemoveTokenLib: ManagedPool.addRemoveTokenLib.address,
        },
      });
    }

    return deploy('v2-pool-weighted/' + poolType, {
      args: [
        {
          name: NAME,
          symbol: SYMBOL,
          assetManagers: assetManagers,
        },
        {
          vault: vault.address,
          protocolFeeProvider: vault.protocolFeesProvider.address,
          weightedMath: ManagedPool.weightedMathLib.address,
          recoveryModeHelper: ManagedPool.recoverModeHelperLib.address,
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
          aumFeeId: aumFeeId,
        },
        owner,
      ],
      from,
      libraries: {
        CircuitBreakerLib: ManagedPool.circuitBreakerLib.address,
        ManagedPoolAddRemoveTokenLib: ManagedPool.addRemoveTokenLib.address,
        ManagedPoolAmmLib: ManagedPool.ammLib.address,
      },
    });
  }

  static async _deployFromFactory(params: ManagedPoolDeployment, vault: Vault): Promise<Contract> {
    const {
      tokens,
      weights,
      assetManagers,
      swapFeePercentage,
      swapEnabledOnStart,
      mustAllowlistLPs,
      managementAumFeePercentage,
      aumFeeId,
      factoryVersion,
      poolVersion,
      from,
    } = params;

    const factory = await deploy('v2-pool-weighted/ManagedPoolFactory', {
      args: [
        vault.address,
        vault.getFeesProvider().address,
        ManagedPool.weightedMathLib.address,
        ManagedPool.recoverModeHelperLib.address,
        factoryVersion,
        poolVersion,
        PAUSE_WINDOW_DURATION,
        BUFFER_PERIOD_DURATION,
      ],
      from,
      libraries: {
        CircuitBreakerLib: ManagedPool.circuitBreakerLib.address,
        ManagedPoolAddRemoveTokenLib: ManagedPool.addRemoveTokenLib.address,
      },
    });

    const poolParams: ManagedPoolParams = {
      name: NAME,
      symbol: SYMBOL,
      assetManagers,
    };

    const settingsParams: ManagedPoolSettingsParams = {
      tokens: tokens.addresses,
      normalizedWeights: weights,
      swapFeePercentage: swapFeePercentage,
      swapEnabledOnStart: swapEnabledOnStart,
      mustAllowlistLPs: mustAllowlistLPs,
      managementAumFeePercentage: managementAumFeePercentage,
      aumFeeId: aumFeeId ?? ProtocolFee.AUM,
    };

    const salt = randomBytes(32);

    const tx = await factory
      .connect(from || ZERO_ADDRESS)
      .create(poolParams, settingsParams, from?.address || ZERO_ADDRESS, salt);
    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'ManagedPoolCreated');

    return deployedAt('v2-pool-weighted/ManagedPool', event.args.pool);
  }

  async updateWeightsGradually(
    from: SignerWithAddress,
    startTime: BigNumberish,
    endTime: BigNumberish,
    endWeights: BigNumberish[],
    tokens?: string[]
  ): Promise<ContractTransaction> {
    const pool = this.instance.connect(from);

    if (!tokens) {
      const { tokens: registeredTokens } = await this.getTokens();
      // If the first token is BPT then we can assume that the Pool is composable.
      if (registeredTokens[0] == this.address) {
        tokens = registeredTokens.slice(1);
      } else {
        tokens = registeredTokens;
      }
    }

    return await pool.updateWeightsGradually(startTime, endTime, tokens, endWeights);
  }

  async updateSwapFeeGradually(
    from: SignerWithAddress,
    startTime: BigNumberish,
    endTime: BigNumberish,
    startSwapFeePercentage: BigNumberish,
    endSwapFeePercentage: BigNumberish
  ): Promise<ContractTransaction> {
    const pool = this.instance.connect(from);
    return await pool.updateSwapFeeGradually(startTime, endTime, startSwapFeePercentage, endSwapFeePercentage);
  }

  async version(): Promise<string[]> {
    return this.instance.version();
  }

  async getGradualSwapFeeUpdateParams(from?: SignerWithAddress): Promise<GradualSwapFeeUpdateParams> {
    const pool = from ? this.instance.connect(from) : this.instance;
    return await pool.getGradualSwapFeeUpdateParams();
  }

  async getCircuitBreakerState(token: Token | string): Promise<CircuitBreakerState> {
    return await this.instance.getCircuitBreakerState(TypesConverter.toAddress(token));
  }

  async addToken(
    from: SignerWithAddress,
    token: Token | string,
    assetManager: Account,
    normalizedWeight: BigNumberish,
    mintAmount?: BigNumberish,
    recipient?: string
  ): Promise<ContractTransaction> {
    return this.instance
      .connect(from)
      .addToken(
        TypesConverter.toAddress(token),
        accountToAddress(assetManager),
        normalizedWeight,
        mintAmount ?? 0,
        recipient ?? from.address
      );
  }

  async removeToken(
    from: SignerWithAddress,
    token: Token | string,
    sender?: string,
    burnAmount?: BigNumberish
  ): Promise<ContractTransaction> {
    return this.instance
      .connect(from)
      .removeToken(TypesConverter.toAddress(token), burnAmount ?? 0, sender ?? from.address);
  }

  async setCircuitBreakers(
    from: SignerWithAddress,
    tokens: Token[] | string[],
    bptPrices: BigNumber[],
    lowerBounds: BigNumber[],
    upperBounds: BigNumber[]
  ): Promise<ContractTransaction> {
    const tokensArg = tokens.map((t) => TypesConverter.toAddress(t));
    const pool = this.instance.connect(from);

    return await pool.setCircuitBreakers(tokensArg, bptPrices, lowerBounds, upperBounds);
  }

  async setManagementAumFeePercentage(
    from: SignerWithAddress,
    managementFee: BigNumberish
  ): Promise<ContractTransaction> {
    const pool = this.instance.connect(from);
    return pool.setManagementAumFeePercentage(managementFee);
  }

  async addAllowedAddress(from: SignerWithAddress, member: Account): Promise<ContractTransaction> {
    const pool = this.instance.connect(from);
    return pool.addAllowedAddress(TypesConverter.toAddress(member));
  }

  async removeAllowedAddress(from: SignerWithAddress, member: Account): Promise<ContractTransaction> {
    const pool = this.instance.connect(from);
    return pool.removeAllowedAddress(TypesConverter.toAddress(member));
  }

  async getMustAllowlistLPs(): Promise<boolean> {
    return this.instance.getMustAllowlistLPs();
  }

  async setMustAllowlistLPs(from: SignerWithAddress, mustAllowlistLPs: boolean): Promise<ContractTransaction> {
    const pool = this.instance.connect(from);
    return pool.setMustAllowlistLPs(mustAllowlistLPs);
  }

  async isAllowedAddress(member: string): Promise<boolean> {
    return this.instance.isAllowedAddress(member);
  }

  async collectAumManagementFees(from: SignerWithAddress): Promise<ContractTransaction> {
    const pool = this.instance.connect(from);
    return pool.collectAumManagementFees();
  }

  async getJoinExitEnabled(from: SignerWithAddress): Promise<boolean> {
    return this.instance.connect(from).getJoinExitEnabled();
  }

  async getSwapEnabled(from: SignerWithAddress): Promise<boolean> {
    return this.instance.connect(from).getSwapEnabled();
  }

  async getManagementAumFeeParams(): Promise<[BigNumber, BigNumber]> {
    return this.instance.getManagementAumFeeParams();
  }
}
