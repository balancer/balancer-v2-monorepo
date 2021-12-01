import { Contract } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';

import { RawLinearPoolDeployment, LinearPoolDeployment } from './types';

import Vault from '../../vault/Vault';
import Token from '../../tokens/Token';
import LinearPool from './LinearPool';
import VaultDeployer from '../../vault/VaultDeployer';
import TypesConverter from '../../types/TypesConverter';

const NAME = 'Balancer Pool Token';
const SYMBOL = 'BPT';

export default {
  async deploy(params: RawLinearPoolDeployment, mockedVault: boolean): Promise<LinearPool> {
    const vaultParams = TypesConverter.toRawVaultDeployment(params);
    vaultParams.mocked = mockedVault;
    const vault = params.vault ?? (await VaultDeployer.deploy(vaultParams));

    const deployment = TypesConverter.toLinearPoolDeployment(params);

    const pool = await this._deployStandalone(deployment, vault);

    const { owner, mainToken, wrappedToken, lowerTarget, upperTarget, swapFeePercentage } = deployment;

    const poolId = await pool.getPoolId();
    const name = await pool.name();
    const symbol = await pool.symbol();
    const decimals = await pool.decimals();
    const bptToken = new Token(name, symbol, decimals, pool);

    return new LinearPool(
      pool,
      poolId,
      vault,
      mainToken,
      wrappedToken,
      bptToken,
      lowerTarget,
      upperTarget,
      swapFeePercentage,
      owner
    );
  },

  async _deployStandalone(params: LinearPoolDeployment, vault: Vault): Promise<Contract> {
    const {
      mainToken,
      wrappedToken,
      lowerTarget,
      upperTarget,
      swapFeePercentage,
      pauseWindowDuration,
      bufferPeriodDuration,
      from,
    } = params;

    const owner = TypesConverter.toAddress(params.owner);

    return deploy('v2-pool-linear/MockLinearPool', {
      args: [
        {
          vault: vault.address,
          name: NAME,
          symbol: SYMBOL,
          mainToken: mainToken.address,
          wrappedToken: wrappedToken.address,
          lowerTarget,
          upperTarget,
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
