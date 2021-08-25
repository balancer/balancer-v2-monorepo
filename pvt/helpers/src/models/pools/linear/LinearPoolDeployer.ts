import { Contract } from 'ethers';

import { deploy } from '../../../contract';

import Vault from '../../vault/Vault';
import LinearPool from './LinearPool';
import VaultDeployer from '../../vault/VaultDeployer';
import TypesConverter from '../../types/TypesConverter';
import Token from '../../tokens/Token';
import TokenList from '../../tokens/TokenList';

import { RawLinearPoolDeployment, LinearPoolDeployment } from './types';

const NAME = 'Balancer Pool Token';
const SYMBOL = 'BPT';

export default {
  async deploy(params: RawLinearPoolDeployment, mockedVault: boolean): Promise<LinearPool> {
    const deployment = TypesConverter.toLinearPoolDeployment(params);
    const vaultParams = TypesConverter.toRawVaultDeployment(params);
    vaultParams.mocked = mockedVault;
    const vault = params.vault ?? (await VaultDeployer.deploy(vaultParams));
    const pool = await this._deployStandalone(deployment, vault);

    const { owner, mainToken, wrappedToken, lowerTarget, upperTarget, swapFeePercentage } = deployment;
    const poolId = await pool.getPoolId();

    const name = await pool.name();
    const symbol = await pool.symbol();
    const decimals = await pool.decimals();
    const bptToken = new Token(name, symbol, decimals, pool);

    const tokens = new TokenList([wrappedToken, mainToken, bptToken]).sort();

    return new LinearPool(pool, poolId, vault, tokens, lowerTarget, upperTarget, swapFeePercentage, owner);
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

    return deploy('v2-pool-linear/LinearPool', {
      args: [
        vault.address,
        NAME,
        SYMBOL,
        mainToken.address,
        wrappedToken.address,
        lowerTarget,
        upperTarget,
        swapFeePercentage,
        pauseWindowDuration,
        bufferPeriodDuration,
        owner,
      ],
      from,
    });
  },
};
