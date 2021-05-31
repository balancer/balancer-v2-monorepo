import { Contract } from 'ethers';

import * as expectEvent from '../../../test/expectEvent';
import { deploy, deployedAt } from '../../../contract';

import Vault from '../../vault/Vault';
import LiquidityBootstrappingPool from './LiquidityBootstrappingPool';
import VaultDeployer from '../../vault/VaultDeployer';
import TypesConverter from '../../types/TypesConverter';
import { RawLiquidityBootstrappingPoolDeployment, LiquidityBootstrappingPoolDeployment } from './types';

const NAME = 'Balancer Pool Token';
const SYMBOL = 'BPT';

export default {
  async deploy(params: RawLiquidityBootstrappingPoolDeployment): Promise<LiquidityBootstrappingPool> {
    const deployment = TypesConverter.toLiquidityBootstrappingPoolDeployment(params);
    const vault = await VaultDeployer.deploy(TypesConverter.toRawVaultDeployment(params));
    const pool = await (params.fromFactory ? this._deployFromFactory : this._deployStandalone)(deployment, vault);

    const { tokens, weights, swapFeePercentage } = deployment;
    const poolId = await pool.getPoolId();
    return new LiquidityBootstrappingPool(pool, poolId, vault, tokens, weights, swapFeePercentage);
  },

  async _deployStandalone(params: LiquidityBootstrappingPoolDeployment, vault: Vault): Promise<Contract> {
    const { tokens, weights, swapFeePercentage, pauseWindowDuration, bufferPeriodDuration, owner, from } = params;
    return deploy('v2-pool-weighted/smart/LiquidityBootstrappingPool', {
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
      ],
      from,
    });
  },

  async _deployFromFactory(params: LiquidityBootstrappingPoolDeployment, vault: Vault): Promise<Contract> {
    const { tokens, weights, swapFeePercentage, owner, from } = params;
    const factory = await deploy('v2-pool-weighted/smart/LiquidityBootstrappingPoolFactory', { args: [vault.address], from });

    const tx = await factory.create(
      NAME,
      SYMBOL,
      tokens.addresses,
      weights,
      swapFeePercentage,
      TypesConverter.toAddress(owner)
    );
    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolCreated');
    return deployedAt('v2-pool-weighted/smart/LiquidityBootstrappingPool', event.args.pool);
  },
};
