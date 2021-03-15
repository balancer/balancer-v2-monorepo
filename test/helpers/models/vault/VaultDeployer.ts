import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Vault from './Vault';
import TypesConverter from '../types/TypesConverter';
import { deploy } from '../../../../lib/helpers/deploy';
import { RawVaultDeployment, VaultDeployment } from './types';

export default {
  async deploy(params: RawVaultDeployment): Promise<Vault> {
    const deployment = TypesConverter.toVaultDeployment(params);

    let { admin } = deployment;
    const { from } = deployment;
    if (!admin) admin = from || (await ethers.getSigners())[0];

    const authorizer = await this._deployAuthorizer(admin, from);
    const instance = await (deployment.mocked ? this._deployMocked : this._deployReal)(deployment, authorizer);
    return new Vault(false, instance, authorizer, admin);
  },

  async _deployReal(deployment: VaultDeployment, authorizer: Contract): Promise<Contract> {
    const { from, emergencyPeriod, emergencyPeriodCheckExtension } = deployment;
    const args = [authorizer.address, emergencyPeriod, emergencyPeriodCheckExtension];
    return deploy('Vault', { args, from });
  },

  async _deployMocked({ from }: VaultDeployment, authorizer: Contract): Promise<Contract> {
    return deploy('MockVault', { from, args: [authorizer.address] });
  },

  async _deployAuthorizer(admin: SignerWithAddress, from?: SignerWithAddress): Promise<Contract> {
    return deploy('Authorizer', { args: [admin.address], from });
  },
};
