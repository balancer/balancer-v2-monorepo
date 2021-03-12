import { ethers } from 'hardhat';
import { Contract } from 'ethers';

import * as expectEvent from '../../../expectEvent';
import { deploy } from '../../../../../lib/helpers/deploy';

import WeightedPool from './WeightedPool';
import VaultDeployer from '../../vault/VaultDeployer';
import TypesConverter from '../../types/TypesConverter';
import { RawWeightedPoolDeployment, WeightedPoolDeployment } from './types';

const NAME = 'Balancer Pool Token';
const SYMBOL = 'BPT';

export default {
  async deploy(params: RawWeightedPoolDeployment): Promise<WeightedPool> {
    const deployment = TypesConverter.toWeightedPoolDeployment(params);
    const vault = await VaultDeployer.deploy({ mocked: !params.fromFactory });
    const admin = deployment.from || (await ethers.getSigners())[0];
    const authorizer = await deploy('Authorizer', { args: [admin.address] });
    const deployFn = params.fromFactory ? this._deployFromFactory : this._deployStandalone;
    const pool = await deployFn(deployment, vault, authorizer);
    const { tokens, weights, swapFee } = deployment;
    const poolId = await pool.getPoolId();
    return new WeightedPool(pool, poolId, vault, authorizer, admin, tokens, weights, swapFee);
  },

  async _deployStandalone(params: WeightedPoolDeployment, vault: Contract, authorizer: Contract): Promise<Contract> {
    const { tokens, weights, swapFee, emergencyPeriod, emergencyPeriodCheckExtension } = params;
    return deploy('WeightedPool', {
      args: [
        authorizer.address,
        vault.address,
        NAME,
        SYMBOL,
        tokens.addresses,
        weights,
        swapFee,
        emergencyPeriod,
        emergencyPeriodCheckExtension,
      ],
    });
  },

  async _deployFromFactory(params: WeightedPoolDeployment, vault: Contract, authorizer: Contract): Promise<Contract> {
    const { tokens, weights, swapFee, emergencyPeriod, emergencyPeriodCheckExtension } = params;
    const factory = await deploy('WeightedPoolFactory', { args: [authorizer.address, vault.address] });
    const tx = await factory.create(
      NAME,
      SYMBOL,
      tokens.addresses,
      weights,
      swapFee,
      emergencyPeriod,
      emergencyPeriodCheckExtension
    );
    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolRegistered');
    return ethers.getContractAt('WeightedPool', event.args.pool);
  },
};
