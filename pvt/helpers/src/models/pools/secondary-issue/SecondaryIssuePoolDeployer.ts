import { Contract } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';

import { RawSecondaryPoolDeployment, SecondaryPoolDeployment } from './types';

import Vault from '../../vault/Vault';
import Token from '../../tokens/Token';
import SecondaryPool from './SecondaryIssuePool';
import VaultDeployer from '../../vault/VaultDeployer';
import TypesConverter from '../../types/TypesConverter';

const NAME = 'Verified Liquidity Token';
const SYMBOL = 'VITTA';

export default {
  async deploy(params: RawSecondaryPoolDeployment, mockedVault: boolean): Promise<SecondaryPool> {
    const vaultParams = TypesConverter.toRawVaultDeployment(params);
    vaultParams.mocked = mockedVault;
    const vault = params.vault ?? (await VaultDeployer.deploy(vaultParams));

    const deployment = TypesConverter.toSecondaryPoolDeployment(params);

    const pool = await this._deployStandalone(deployment, vault);

    const { owner, securityToken, currencyToken, maxSecurityOffered, swapFeePercentage } = deployment;

    const poolId = await pool.getPoolId();

    return new SecondaryPool(
      pool,
      poolId,
      vault,
      securityToken,
      currencyToken,
      maxSecurityOffered,
      swapFeePercentage,
      owner
    );
  },

  async _deployStandalone(params: SecondaryPoolDeployment, vault: Vault): Promise<Contract> {
    const {
      securityToken,
      currencyToken,
      maxSecurityOffered,      
      swapFeePercentage,
      pauseWindowDuration,
      bufferPeriodDuration,
      from,
    } = params;

    const owner = TypesConverter.toAddress(params.owner);

    return deploy('pool-secondary-issues/SecondaryIssuePool', {
      args: [
        vault.address,
        NAME,
        SYMBOL,
        securityToken.address,
        currencyToken.address,
        maxSecurityOffered,
        swapFeePercentage,
        pauseWindowDuration,
        bufferPeriodDuration,
        owner,
      ],
      from,
    });
  },
};
