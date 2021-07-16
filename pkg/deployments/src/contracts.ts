import { Contract, utils } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { getSigner } from './signers';
import { Artifact, Param } from './types';

export async function deploy(artifact: Artifact, args: Array<Param> = [], from?: SignerWithAddress): Promise<Contract> {
  if (!args) args = [];
  if (!from) from = await getSigner();

  const { ethers } = await import('hardhat');
  const factory = await ethers.getContractFactory(artifact.abi, artifact.evm.bytecode.object as utils.BytesLike);
  const deployment = await factory.connect(from).deploy(...args);
  return deployment.deployed();
}

export async function instanceAt(artifact: Artifact, address: string): Promise<Contract> {
  const { ethers } = await import('hardhat');
  return ethers.getContractAt(artifact.abi, address);
}
