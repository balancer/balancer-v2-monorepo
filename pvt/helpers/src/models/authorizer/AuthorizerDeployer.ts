import { ethers } from 'hardhat';

import { deploy } from '../../contract';
import { AuthorizerDeployment } from './types';

import Authorizer from './Authorizer';
import TypesConverter from '../types/TypesConverter';

export default {
  async deploy(deployment: AuthorizerDeployment): Promise<Authorizer> {
    const admin = deployment.admin || deployment.from || (await ethers.getSigners())[0];
    const vault = TypesConverter.toAddress(deployment.vault);
    const instance = await deploy('Authorizer', { args: [TypesConverter.toAddress(admin), vault] });
    return new Authorizer(instance, admin);
  },
};
