import { ethers } from 'hardhat';
import { ScriptRunEnvironment } from './types';
import { transactionOverrides } from './constants';
import { Network } from '../src/types';

const setupScriptRunEnvironment = async (network: Network): Promise<ScriptRunEnvironment> => {
  const signers = await ethers.getSigners();
  const deployer = signers[0];

  return { network, deployer, transactionOverrides };
};

export default setupScriptRunEnvironment;
