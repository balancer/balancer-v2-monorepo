import { Contract } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';

import { RawStablePoolDeployment, StablePoolDeployment } from './types';

import Vault from '../../vault/Vault';
import VaultDeployer from '../../vault/VaultDeployer';
import TypesConverter from '../../types/TypesConverter';
import StablePool from './StablePool';

const NAME = 'Balancer Pool Token';
const SYMBOL = 'BPT';

export default {
  async deploy(params: RawStablePoolDeployment): Promise<StablePool> {
    const deployment = TypesConverter.toStablePoolDeployment(params);
    const vaultParams = { ...TypesConverter.toRawVaultDeployment(params), mocked: params.mockedVault ?? false };
    const vault = params?.vault ?? (await VaultDeployer.deploy(vaultParams));
    const pool = await this._deployStandalone(deployment, vault);

    const poolId = await pool.getPoolId();
    const bptIndex = await pool.getBptIndex();
    const { tokens, swapFeePercentage, amplificationParameter, owner } = deployment;

    return new StablePool(pool, poolId, vault, tokens, bptIndex, swapFeePercentage, amplificationParameter, owner);
  },

  async _deployStandalone(params: StablePoolDeployment, vault: Vault): Promise<Contract> {
    const {
      tokens,
      rateProviders,
      tokenRateCacheDurations,
      exemptFromYieldProtocolFeeFlags,
      swapFeePercentage,
      pauseWindowDuration,
      bufferPeriodDuration,
      amplificationParameter,
      from,
      version,
    } = params;

    const owner = TypesConverter.toAddress(params.owner);

    return deploy('v2-pool-stable/MockComposableStablePool', {
      args: [
        {
          vault: vault.address,
          protocolFeeProvider: vault.getFeesProvider().address,
          name: NAME,
          symbol: SYMBOL,
          tokens: tokens.addresses,
          rateProviders: TypesConverter.toAddresses(rateProviders),
          tokenRateCacheDurations,
          exemptFromYieldProtocolFeeFlags,
          amplificationParameter,
          swapFeePercentage,
          pauseWindowDuration,
          bufferPeriodDuration,
          owner,
          version: version,
        },
      ],
      from,
    });
  },
};
