import { Contract } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';

import { RawPrimaryPoolDeployment, PrimaryPoolDeployment } from './types';

import Vault from '../../vault/Vault';
import Token from '../../tokens/Token';
import PrimaryPool from './PrimaryIssuePool';
import VaultDeployer from '../../vault/VaultDeployer';
import TypesConverter from '../../types/TypesConverter';

const NAME = 'Balancer Pool Token';
const SYMBOL = 'BPT';

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
      offeringDocs,
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
      offeringDocs,
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
      offeringDocs,
      from,
    } = params;

    const owner = TypesConverter.toAddress(params.owner);

    let FactoryPoolParams ={
      name: NAME,
      symbol: SYMBOL,
      security: securityToken.address,
      currency: currencyToken.address,
      minimumPrice: minimumPrice,
      basePrice: basePrice,
      maxAmountsIn: maxSecurityOffered,
      swapFeePercentage: swapFeePercentage,
      cutOffTime: issueCutoffTime,
      offeringDocs: offeringDocs
  }

    return deploy('pool-primary-issues/MockPrimaryIssuePool', {
      args: [
        vault.address,
        FactoryPoolParams,
        pauseWindowDuration,
        bufferPeriodDuration,
        owner,
      ],
      from,
    });
  },

};
