import { BigNumber, Contract, ContractTransaction } from 'ethers';
import TypesConverter from '../../types/TypesConverter';
import VaultDeployer from '../../vault/VaultDeployer';
import WeightedPool from './WeightedPool';
import { NAME, SYMBOL } from '../base/BasePool';
import {
  RawManagedPoolDeployment,
  ManagedPoolDeployment,
  ManagedPoolParams,
  BasePoolRights,
  ManagedPoolRights,
  GradualSwapFeeUpdateParams,
  CircuitBreakerState,
} from './types';
import Vault from '../../vault/Vault';
import { deploy, deployedAt } from '../../../contract';
import * as expectEvent from '../../../test/expectEvent';
import { Account } from '../../types/types';
import TokenList from '../../tokens/TokenList';
import { BigNumberish } from '../../../numbers';
import { ProtocolFee } from '../../vault/types';
import { ZERO_ADDRESS } from '../../../constants';
import { DAY } from '../../../time';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import Token from '../../tokens/Token';
import { accountToAddress } from '@balancer-labs/balancer-js';

export default class ManagedPool extends WeightedPool {
  static weightedMathLib: Contract;
  static addRemoveTokenLib: Contract;
  static circuitBreakerLib: Contract;

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
    rateProviders: Account[],
    assetManagers: string[],
    swapFeePercentage: BigNumberish,
    swapEnabledOnStart: boolean,
    mustAllowlistLPs: boolean,
    managementAumFeePercentage: BigNumberish,
    poolVersion: string,
    aumFeeId?: BigNumberish,
    owner?: Account
  ) {
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

    const pool = await (params.fromFactory ? this._deployFromFactory : this._deployStandalone)(deployment, vault);
    const poolId = await pool.getPoolId();

    const {
      tokens,
      weights,
      rateProviders,
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
      rateProviders,
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

  static async _deployStandalone(params: ManagedPoolDeployment, vault: Vault): Promise<Contract> {
    const {
      tokens,
      weights,
      swapFeePercentage,
      assetManagers,
      swapEnabledOnStart,
      mustAllowlistLPs,
      managementAumFeePercentage,
      aumFeeId,
      poolVersion,
      owner,
      pauseWindowDuration,
      bufferPeriodDuration,
      mockContractName,
      from,
    } = params;

    if (mockContractName == 'MockManagedPoolSettings') {
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

    return deploy(mockContractName ?? 'v2-pool-weighted/ManagedPool', {
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
      },
    });
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
      from,
    } = params;

    const factory = await deploy('v2-pool-weighted/ManagedPoolFactory', {
      args: [vault.address, vault.getFeesProvider().address],
      from,
      libraries: {
        CircuitBreakerLib: ManagedPool.circuitBreakerLib.address,
        ManagedPoolAddRemoveTokenLib: ManagedPool.addRemoveTokenLib.address,
      },
    });

    const controlledFactory = await deploy('v2-pool-weighted/ControlledManagedPoolFactory', {
      args: [factory.address],
      from,
    });

    const newPoolParams: ManagedPoolParams = {
      name: NAME,
      symbol: SYMBOL,
      tokens: tokens.addresses,
      normalizedWeights: weights,
      assetManagers: assetManagers,
      swapFeePercentage: swapFeePercentage,
      swapEnabledOnStart: swapEnabledOnStart,
      mustAllowlistLPs: mustAllowlistLPs,
      managementAumFeePercentage: managementAumFeePercentage,
      aumFeeId: aumFeeId ?? ProtocolFee.AUM,
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
      canDisableJoinExit: true,
    };

    const tx = await controlledFactory
      .connect(from || ZERO_ADDRESS)
      .create(newPoolParams, basePoolRights, managedPoolRights, DAY, from?.address || ZERO_ADDRESS);
    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'ManagedPoolCreated');
    return deployedAt('v2-pool-weighted/ManagedPool', event.args.pool);
  }
}
