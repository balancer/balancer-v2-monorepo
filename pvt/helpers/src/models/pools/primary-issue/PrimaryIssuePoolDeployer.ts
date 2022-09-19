import { Contract } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';

import { RawPrimaryPoolDeployment, PrimaryPoolDeployment } from './types';

import Vault from '../../vault/Vault';
import Token from '../../tokens/Token';
import PrimaryPool from './PrimaryIssuePool';
import VaultDeployer from '../../vault/VaultDeployer';
import TypesConverter from '../../types/TypesConverter';

export default {
  
  async deploy(params: RawPrimaryPoolDeployment, mockedVault: boolean): Promise<PrimaryPool> {
    const vaultParams = TypesConverter.toRawVaultDeployment(params);
    vaultParams.mocked = mockedVault;
    const vault = params.vault ?? (await VaultDeployer.deploy(vaultParams));

    const deployment = TypesConverter.toPrimaryPoolDeployment(params);

    const pool = await this._deployStandalone(deployment, vault);

    const {
      owner,
      securityToken,
      currencyToken,
      minimumPrice,
      basePrice,
      maxSecurityOffered,
      swapFeePercentage,
      issueCutoffTime,
    } = deployment;

    const poolId = await pool.getPoolId();
    const name = await pool.name();
    const symbol = await pool.symbol();
    const decimals = await pool.decimals();
    const bptToken = new Token(name, symbol, decimals, pool);

    return new PrimaryPool(
      pool,
      poolId,
      vault,
      securityToken,
      currencyToken,
      bptToken,
      minimumPrice,
      basePrice,
      maxSecurityOffered,
      swapFeePercentage,
      issueCutoffTime,
      owner
    );
  },

  async _deployStandalone(params: PrimaryPoolDeployment, vault: Vault): Promise<Contract> {
    const {
      securityToken,
      currencyToken,
      minimumPrice,
      basePrice,
      maxSecurityOffered,
      swapFeePercentage,      
      pauseWindowDuration,
      bufferPeriodDuration,
      issueCutoffTime,
      from,
    } = params;

    const owner = TypesConverter.toAddress(params.owner);

    return deploy('pool-primary-issues/PrimaryIssuePool', {
      args: [
        vault.address,
        securityToken.address,
        currencyToken.address,
        minimumPrice,
        basePrice,
        maxSecurityOffered,
        swapFeePercentage,
        pauseWindowDuration,
        bufferPeriodDuration,
        issueCutoffTime,
        owner,
      ],
      from,
    });
  },

};
