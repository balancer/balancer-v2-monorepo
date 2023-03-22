import { Contract } from 'ethers';
import TypesConverter from '../../types/TypesConverter';
import Vault from '../../vault/Vault';
import VaultDeployer from '../../vault/VaultDeployer';
import BaseWeightedPool from './BaseWeightedPool';
import { BUFFER_PERIOD_DURATION, NAME, PAUSE_WINDOW_DURATION, SYMBOL } from '../base/BasePool';
import { deploy, deployedAt } from '../../../contract';
import { RawLiquidityBootstrappingPoolDeployment, LiquidityBootstrappingPoolDeployment } from './types';
import TokenList from '../../tokens/TokenList';
import { BigNumberish } from '../../../numbers';
import { Account } from '../../types/types';
import * as expectEvent from '../../../test/expectEvent';
import { randomBytes } from 'ethers/lib/utils';

export default class LiquidityBootstrappingPool extends BaseWeightedPool {
  swapEnabledOnStart: boolean;

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
    const { from } = params;

    return deploy('v2-pool-weighted/LiquidityBootstrappingPool', {
      args: [
        vault.address,
        NAME,
        SYMBOL,
        params.tokens.addresses,
        params.weights,
        params.swapFeePercentage,
        params.pauseWindowDuration,
        params.bufferPeriodDuration,
        TypesConverter.toAddress(params.owner),
        params.swapEnabledOnStart,
      ],
      from,
    });
  }

  static async _deployFromFactory(params: LiquidityBootstrappingPoolDeployment, vault: Vault): Promise<Contract> {
    const { tokens, weights, swapFeePercentage, swapEnabledOnStart, owner, from } = params;

    const factory = await deploy('v2-pool-weighted/LiquidityBootstrappingPoolFactory', {
      args: [vault.address, vault.getFeesProvider().address, PAUSE_WINDOW_DURATION, BUFFER_PERIOD_DURATION],
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
      randomBytes(32)
    );
    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolCreated');
    return deployedAt('v2-pool-weighted/LiquidityBootstrappingPool', event.args.pool);
  }
}
