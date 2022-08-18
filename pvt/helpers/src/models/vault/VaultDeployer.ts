import { ethers } from 'hardhat';
import { BigNumberish, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '../../contract';
import { MONTH } from '../../time';
import { ZERO_ADDRESS } from '../../constants';
import { RawVaultDeployment, VaultDeployment } from './types';

import Vault from './Vault';
import TypesConverter from '../types/TypesConverter';
import TokensDeployer from '../tokens/TokensDeployer';

export default {
  async deploy(params: RawVaultDeployment): Promise<Vault> {
    const deployment = TypesConverter.toVaultDeployment(params);

    let { admin } = deployment;
    const { from, mocked } = deployment;
    if (!admin) admin = from || (await ethers.getSigners())[0];

    const authorizer = await this._deployAuthorizer(admin, from);
    const vault = await (mocked ? this._deployMocked : this._deployReal)(deployment, authorizer);
    const protocolFeeProvider = await this._deployProtocolFeeProvider(
      vault,
      deployment.maxYieldValue,
      deployment.maxAUMValue
    );
    return new Vault(mocked, vault, authorizer, protocolFeeProvider, admin);
  },

  async _deployReal(deployment: VaultDeployment, authorizer: Contract): Promise<Contract> {
    const { from, pauseWindowDuration, bufferPeriodDuration } = deployment;
    const weth = await TokensDeployer.deployToken({ symbol: 'WETH' });
    const args = [authorizer.address, weth.address, pauseWindowDuration, bufferPeriodDuration];
    return deploy('v2-vault/Vault', { args, from });
  },

  async _deployMocked({ from }: VaultDeployment, authorizer: Contract): Promise<Contract> {
    return deploy('v2-pool-utils/MockVault', { from, args: [authorizer.address] });
  },

  async _deployAuthorizer(admin: SignerWithAddress, from?: SignerWithAddress): Promise<Contract> {
    return deploy('v2-vault/TimelockAuthorizer', { args: [admin.address, ZERO_ADDRESS, MONTH], from });
  },

  async _deployProtocolFeeProvider(
    vault: Contract,
    maxYieldValue: BigNumberish,
    maxAUMValue: BigNumberish
  ): Promise<Contract> {
    return deploy('v2-standalone-utils/ProtocolFeePercentagesProvider', {
      args: [vault.address, maxYieldValue, maxAUMValue],
    });
  },
};
