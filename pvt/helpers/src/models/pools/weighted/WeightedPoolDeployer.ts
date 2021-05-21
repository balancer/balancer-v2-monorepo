import { Contract } from 'ethers';

import * as expectEvent from '../../../test/expectEvent';
import { deploy, deployedAt } from '../../../contract';

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

    const { tokens, weights, swapFeePercentage, twoTokens } = deployment;
    const poolId = await pool.getPoolId();
    return new WeightedPool(pool, poolId, vault, tokens, weights, swapFeePercentage, twoTokens);
  },

  async _deployStandalone(params: WeightedPoolDeployment, vault: Vault): Promise<Contract> {
    const {
      tokens,
      weights,
      swapFeePercentage,
      pauseWindowDuration,
      bufferPeriodDuration,
      oracleEnabled,
      owner,
      from,
    } = params;
    return params.twoTokens
      ? deploy('v2-pool-weighted/WeightedPool2TokensMock', {
          args: [
            {
              vault: vault.address,
              name: NAME,
              symbol: SYMBOL,
              token0: tokens.addresses[0],
              token1: tokens.addresses[1],
              normalizedWeight0: weights[0],
              normalizedWeight1: weights[1],
              swapFeePercentage: swapFeePercentage,
              pauseWindowDuration: pauseWindowDuration,
              bufferPeriodDuration: bufferPeriodDuration,
              oracleEnabled: oracleEnabled,
              owner: TypesConverter.toAddress(owner),
            },
          ],
          from,
        })
      : deploy('v2-pool-weighted/WeightedPool', {
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
    const { tokens, weights, swapFeePercentage, oracleEnabled, owner, from } = params;

    if (params.twoTokens) {
      const factory = await deploy('v2-pool-weighted/WeightedPool2TokensFactory', { args: [vault.address], from });
      const tx = await factory.create(
        NAME,
        SYMBOL,
        tokens.addresses,
        weights,
        swapFeePercentage,
        oracleEnabled,
        TypesConverter.toAddress(owner)
      );
      const receipt = await tx.wait();
      const event = expectEvent.inReceipt(receipt, 'PoolCreated');
      return deployedAt('v2-pool-weighted/WeightedPool2Tokens', event.args.pool);
    } else {
      const factory = await deploy('v2-pool-weighted/WeightedPoolFactory', { args: [vault.address], from });
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
      return deployedAt('v2-pool-weighted/WeightedPool', event.args.pool);
    }
  },
};
