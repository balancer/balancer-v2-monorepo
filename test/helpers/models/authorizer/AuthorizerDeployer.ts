import { ethers } from 'hardhat';
import { Contract } from 'ethers';

import { deploy } from '../../../../lib/helpers/deploy';

import { AuthorizerDeployment } from './types';
import TypesConverter from '../types/TypesConverter';

export default {
  async deploy(deployment: AuthorizerDeployment): Promise<Contract> {
    const admin = deployment.admin || deployment.from || (await ethers.getSigners())[0];
    return deploy('Authorizer', { args: [TypesConverter.toAddress(admin)] });
  },
};
