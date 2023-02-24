import { ethers } from 'hardhat';

import { MONTH } from '../../time';
import { deploy } from '../../contract';
import { TimelockAuthorizerDeployment } from './types';

import TimelockAuthorizer from './TimelockAuthorizer';
import TypesConverter from '../types/TypesConverter';
import { ZERO_ADDRESS } from '../../constants';

export default {
  async deploy(deployment: TimelockAuthorizerDeployment): Promise<TimelockAuthorizer> {
    const root = deployment.root || deployment.from || (await ethers.getSigners())[0];
    const nextRoot = deployment.nextRoot || ZERO_ADDRESS;
    const rootTransferDelay = deployment.rootTransferDelay || MONTH;
    const entrypoint = await deploy('MockAuthorizerAdaptorEntrypoint');
    const args = [
      TypesConverter.toAddress(root),
      TypesConverter.toAddress(nextRoot),
      entrypoint.address,
      rootTransferDelay,
    ];
    const instance = await deploy('TimelockAuthorizer', { args });
    return new TimelockAuthorizer(instance, root);
  },
};
