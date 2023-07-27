import { Contract } from 'ethers';
import TypesConverter from '../../types/TypesConverter';
import Vault from '../../vault/Vault';
import VaultDeployer from '../../vault/VaultDeployer';
import { BUFFER_PERIOD_DURATION, NAME, PAUSE_WINDOW_DURATION, SYMBOL } from '../base/BasePool';
import { deploy, deployedAt } from '../../../contract';
import {
  RawLiquidityBootstrappingPoolDeployment,
  LiquidityBootstrappingPoolDeployment,
  AMLiquidityBootstrappingPoolParams,
  BasePoolRights,
} from './types';
import TokenList from '../../tokens/TokenList';
import { BigNumberish } from '../../../numbers';
import { Account } from '../../types/types';
import * as expectEvent from '../../../test/expectEvent';
import { randomBytes } from 'ethers/lib/utils';
import LiquidityBootstrappingPool from './LiquidityBootstrappingPool';
import { ZERO_ADDRESS } from '../../../constants';

export default class UnseededLiquidityBootstrappingPool extends LiquidityBootstrappingPool {
  constructor(
    instance: Contract,
    poolId: string,
    vault: Vault,
    tokens: TokenList,
    weights: BigNumberish[],
    swapFeePercentage: BigNumberish,
    swapEnabledOnStart: boolean,
    owner?: Account
  ) {
    super(instance, poolId, vault, tokens, weights, swapFeePercentage, owner);

    this.swapEnabledOnStart = swapEnabledOnStart;
  }

  static async create(params: RawLiquidityBootstrappingPoolDeployment = {}): Promise<LiquidityBootstrappingPool> {
    const vault = params?.vault ?? (await VaultDeployer.deploy(TypesConverter.toRawVaultDeployment(params)));
    const deployment = TypesConverter.toLiquidityBootstrappingPoolDeployment(params);
    const pool = await (params.fromFactory ? this._deployFromFactory : this._deployStandalone)(deployment, vault);
    const poolId = await pool.getPoolId();

    const { tokens, weights, swapFeePercentage, owner, swapEnabledOnStart } = deployment;

    return new LiquidityBootstrappingPool(
      pool,
      poolId,
      vault,
      tokens,
      weights,
      swapFeePercentage,
      swapEnabledOnStart,
      owner
    );
  }

  static async _deployStandalone(params: LiquidityBootstrappingPoolDeployment, vault: Vault): Promise<Contract> {
    const { from, reserveAssetManager } = params;

    const newPoolParams: AMLiquidityBootstrappingPoolParams = {
      name: NAME,
      symbol: SYMBOL,
      projectToken: params.tokens.get(0).address,
      reserveToken: params.tokens.get(1).address,
      projectWeight: params.weights[0],
      reserveWeight: params.weights[1],
      swapFeePercentage: params.swapFeePercentage,
      swapEnabledOnStart: params.swapEnabledOnStart,
    };

    return deploy('v2-pool-weighted/AssetManagedLiquidityBootstrappingPool', {
      args: [
        newPoolParams,
        vault.address,
        params.pauseWindowDuration,
        params.bufferPeriodDuration,
        TypesConverter.toAddress(params.owner),
        reserveAssetManager || ZERO_ADDRESS,
      ],
      from,
    });
  }

  static async _deployFromFactory(params: LiquidityBootstrappingPoolDeployment, vault: Vault): Promise<Contract> {
    const { tokens, weights, swapFeePercentage, swapEnabledOnStart, from } = params;

    const factory = await deploy('v2-pool-weighted/UnseededLiquidityBootstrappingPoolFactory', {
      args: [vault.address, vault.getFeesProvider().address, PAUSE_WINDOW_DURATION, BUFFER_PERIOD_DURATION],
      from,
    });

    const newPoolParams: AMLiquidityBootstrappingPoolParams = {
      name: NAME,
      symbol: SYMBOL,
      projectToken: tokens.get(0).address,
      reserveToken: tokens.get(1).address,
      projectWeight: weights[0],
      reserveWeight: weights[1],
      swapFeePercentage: swapFeePercentage,
      swapEnabledOnStart: swapEnabledOnStart,
    };

    const basePoolRights: BasePoolRights = {
      canTransferOwnership: true,
      canChangeSwapFee: true,
      canUpdateMetadata: true,
    };

    const tx = await factory.create(newPoolParams, basePoolRights, from?.address, randomBytes(32));
    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolCreated');
    return deployedAt('v2-pool-weighted/AssetManagedLiquidityBootstrappingPool', event.args.pool);
  }
}
