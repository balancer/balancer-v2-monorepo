import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { Artifact, Param } from './types';

/* eslint-disable @typescript-eslint/no-var-requires */

export async function deploy(artifact: Artifact, args: Array<Param> = [], from?: SignerWithAddress): Promise<Contract> {
  if (!args) args = [];
  if (!from) from = await getSigner();

  const { ethers } = require('hardhat');
  const factory = await ethers.getContractFactory(artifact.abi, artifact.evm.bytecode);
  const deployment = await factory.connect(from).deploy(...args);
  return deployment.deployed();
}

export async function instanceAt(artifact: Artifact, address: string): Promise<Contract> {
  const { ethers } = require('hardhat');
  return ethers.getContractAt(artifact.abi, address);
}

export async function getSigners(): Promise<SignerWithAddress[]> {
  const { ethers } = require('hardhat');
  return ethers.getSigners();
}

export async function getSigner(index = 0): Promise<SignerWithAddress> {
  const signers = await getSigners();
  return signers[index];
}
