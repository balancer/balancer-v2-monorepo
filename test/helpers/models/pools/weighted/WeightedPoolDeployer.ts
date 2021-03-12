import { ethers } from 'hardhat';
import { Contract } from 'ethers';

import * as expectEvent from '../../../expectEvent';
import { deploy } from '../../../../../lib/helpers/deploy';

import WeightedPool from './WeightedPool';
import VaultDeployer from '../../vault/VaultDeployer';
import TypesConverter from '../../types/TypesConverter';
import { RawWeightedPoolDeployment, WeightedPoolDeployment } from './types';

export default {
  async deploy(params: RawWeightedPoolDeployment): Promise<WeightedPool> {
    const deployment = TypesConverter.toWeightedPoolDeployment(params);
    const vault = await VaultDeployer.deploy({ mocked: !params.fromFactory });
    const pool = await (params.fromFactory ? this._deployFromFactory : this._deployStandalone)(deployment, vault);
    const { tokens, weights, swapFee } = deployment;
    const poolId = await pool.getPoolId();
    return new WeightedPool(pool, poolId, vault, tokens, weights, swapFee);
  },

  async _deployStandalone({ tokens, weights, swapFee }: WeightedPoolDeployment, vault: Contract): Promise<Contract> {
    const args = [vault.address, 'Balancer Pool Token', 'BPT', tokens.addresses, weights, swapFee];
    return deploy('WeightedPool', { args });
  },

  async _deployFromFactory({ tokens, weights, swapFee }: WeightedPoolDeployment, vault: Contract): Promise<Contract> {
    const factory = await deploy('WeightedPoolFactory', { args: [vault.address] });
    const tx = await factory.create('Balancer Pool Token', 'BPT', tokens.addresses, weights, swapFee);
    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolRegistered');
    return ethers.getContractAt('WeightedPool', event.args.pool);
  },
};
