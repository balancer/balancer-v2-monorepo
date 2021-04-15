import { ethers } from 'hardhat';
import { Contract } from 'ethers';

import * as expectEvent from '../../../expectEvent';
import { deploy } from '../../../../../lib/helpers/deploy';

import Vault from '../../vault/Vault';
import WeightedPool from './WeightedPool';
import VaultDeployer from '../../vault/VaultDeployer';
import TypesConverter from '../../types/TypesConverter';
import { RawWeightedPoolDeployment, WeightedPoolDeployment } from './types';

const NAME = 'Balancer Pool Token';
const SYMBOL = 'BPT';

export default {
  async deploy(params: RawWeightedPoolDeployment): Promise<WeightedPool> {
    const deployment = TypesConverter.toWeightedPoolDeployment(params);
    const vault = await VaultDeployer.deploy(TypesConverter.toRawVaultDeployment(params));
    const pool = await (params.fromFactory ? this._deployFromFactory : this._deployStandalone)(deployment, vault);

    const { tokens, weights, swapFeePercentage } = deployment;
    const poolId = await pool.getPoolId();
    return new WeightedPool(pool, poolId, vault, tokens, weights, swapFeePercentage);
  },

  async _deployStandalone(params: WeightedPoolDeployment, vault: Vault): Promise<Contract> {
    const { tokens, weights, swapFeePercentage, responseWindowDuration, bufferPeriodDuration, owner, from } = params;
    return deploy('WeightedPool', {
      args: [
        vault.address,
        NAME,
        SYMBOL,
        tokens.addresses,
        weights,
        swapFeePercentage,
        responseWindowDuration,
        bufferPeriodDuration,
        TypesConverter.toAddress(owner),
      ],
      from,
    });
  },

  async _deployFromFactory(params: WeightedPoolDeployment, vault: Vault): Promise<Contract> {
    const { tokens, weights, swapFeePercentage, responseWindowDuration, bufferPeriodDuration, owner, from } = params;
    const factory = await deploy('WeightedPoolFactory', { args: [vault.address], from });
    const tx = await factory.create(
      NAME,
      SYMBOL,
      tokens.addresses,
      weights,
      swapFeePercentage,
      responseWindowDuration,
      bufferPeriodDuration,
      TypesConverter.toAddress(owner)
    );
    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolRegistered');
    return ethers.getContractAt('WeightedPool', event.args.pool);
  },
};
