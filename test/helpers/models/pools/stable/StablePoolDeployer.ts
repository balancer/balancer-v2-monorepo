import { ethers } from 'hardhat';
import { Contract } from 'ethers';

import * as expectEvent from '../../../expectEvent';
import { deploy } from '../../../../../lib/helpers/deploy';

import Vault from '../../vault/Vault';
import StablePool from './StablePool';
import VaultDeployer from '../../vault/VaultDeployer';
import TypesConverter from '../../types/TypesConverter';
import { RawStablePoolDeployment, StablePoolDeployment } from './types';

const NAME = 'Balancer Pool Token';
const SYMBOL = 'BPT';

export default {
  async deploy(params: RawStablePoolDeployment): Promise<StablePool> {
    const deployment = TypesConverter.toStablePoolDeployment(params);
    const vault = await VaultDeployer.deploy(TypesConverter.toRawVaultDeployment(params));
    const pool = await (params.fromFactory ? this._deployFromFactory : this._deployStandalone)(deployment, vault);

    const { tokens, swapFee } = deployment;
    const poolId = await pool.getPoolId();
    return new StablePool(pool, poolId, vault, tokens, swapFee);
  },

  async _deployStandalone(params: StablePoolDeployment, vault: Vault): Promise<Contract> {
    const { tokens, amplificationParammeter, swapFee, emergencyPeriod, emergencyPeriodCheckExtension, from } = params;
    return deploy('StablePool', {
      args: [
        vault.address,
        NAME,
        SYMBOL,
        tokens.addresses,
        amplificationParammeter,
        swapFee,
        emergencyPeriod,
        emergencyPeriodCheckExtension,
      ],
      from,
    });
  },

  async _deployFromFactory(params: StablePoolDeployment, vault: Vault): Promise<Contract> {
    const { tokens, amplificationParammeter, swapFee, emergencyPeriod, emergencyPeriodCheckExtension, from } = params;
    const factory = await deploy('StablePoolFactory', { args: [vault.address], from });
    const tx = await factory.create(
      NAME,
      SYMBOL,
      tokens.addresses,
      amplificationParammeter,
      swapFee,
      emergencyPeriod,
      emergencyPeriodCheckExtension
    );
    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolRegistered');
    return ethers.getContractAt('StablePool', event.args.pool);
  },
};
