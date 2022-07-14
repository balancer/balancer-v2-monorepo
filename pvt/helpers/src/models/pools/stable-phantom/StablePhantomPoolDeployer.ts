import { Contract } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';

import { RawStablePhantomPoolDeployment, StablePhantomPoolDeployment } from './types';

import Vault from '../../vault/Vault';
import VaultDeployer from '../../vault/VaultDeployer';
import TypesConverter from '../../types/TypesConverter';
import StablePhantomPool from './StablePhantomPool';

const NAME = 'Balancer Pool Token';
const SYMBOL = 'BPT';

export default {
  async deploy(params: RawStablePhantomPoolDeployment): Promise<StablePhantomPool> {
    const deployment = TypesConverter.toStablePhantomPoolDeployment(params);
    const vaultParams = { ...TypesConverter.toRawVaultDeployment(params), mocked: params.mockedVault ?? false };
    const vault = params?.vault ?? (await VaultDeployer.deploy(vaultParams));
    const pool = await this._deployStandalone(deployment, vault);

    const poolId = await pool.getPoolId();
    const bptIndex = await pool.getBptIndex();
    const { tokens, swapFeePercentage, amplificationParameter, owner } = deployment;

    return new StablePhantomPool(
      pool,
      poolId,
      vault,
      tokens,
      bptIndex,
      swapFeePercentage,
      amplificationParameter,
      owner
    );
  },

  async _deployStandalone(params: StablePhantomPoolDeployment, vault: Vault): Promise<Contract> {
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
    } = params;

    const owner = TypesConverter.toAddress(params.owner);

    return deploy('v2-pool-stable-phantom/MockStablePhantomPool', {
      args: [
        {
          vault: vault.address,
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
        },
      ],
      from,
    });
  },
};
