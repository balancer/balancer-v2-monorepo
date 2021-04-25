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
    const { tokens, weights, swapFeePercentage, pauseWindowDuration, bufferPeriodDuration, owner, from } = params;
    return params.twoTokens
      ? deploy('WeightedPool2TokensMock', {
          args: [
            vault.address,
            NAME,
            SYMBOL,
            tokens.addresses[0],
            tokens.addresses[1],
            weights[0],
            weights[1],
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            TypesConverter.toAddress(owner),
          ],
          from,
        })
      : deploy('WeightedPool', {
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

  async _deployFromFactory(params: WeightedPoolDeployment, vault: Vault): Promise<Contract> {
    const { tokens, weights, swapFeePercentage, owner, from } = params;
    const factoryName = params.twoTokens ? 'WeightedPool2TokensFactory' : 'WeightedPoolFactory';
    const factory = await deploy(factoryName, { args: [vault.address], from });
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
    const contractName = params.twoTokens ? 'WeightedPool2Tokens' : 'WeightedPool';
    return ethers.getContractAt(contractName, event.args.pool);
  },
};
