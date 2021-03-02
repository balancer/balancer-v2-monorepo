import { Contract } from 'ethers';

import { deploy } from '../../../../lib/helpers/deploy';
import { ZERO_ADDRESS } from '../../../../lib/helpers/constants';

import TypesConverter from '../types/TypesConverter';
import { VaultDeployment } from './types';

export default {
  async deploy(deployment: VaultDeployment): Promise<Contract> {
    return deployment.mocked ? this._deployMocked(deployment) : this._deployReal(deployment);
  },

  async _deployReal(deployment: VaultDeployment): Promise<Contract> {
    const authorizer = await this._deployAuthorizer(deployment);
    return deploy('Vault', { args: [authorizer.address], from: deployment.from });
  },

  async _deployMocked({ from }: VaultDeployment): Promise<Contract> {
    return deploy('MockVault', { args: [], from });
  },

  async _deployAuthorizer({ admin, from }: VaultDeployment): Promise<Contract> {
    const adminAddress = admin ? TypesConverter.toAddress(admin) : ZERO_ADDRESS;
    return deploy('Authorizer', { args: [adminAddress], from });
  },
};
