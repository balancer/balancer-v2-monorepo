import { Contract, ContractFactory } from 'ethers';
import { ethers } from '@nomiclabs/buidler';
import { Dictionary } from 'lodash';

const factories: Dictionary<ContractFactory> = {};

export async function deploy(contractName: string, ...parameters: Array<unknown>): Promise<Contract> {
  const factory = await getFactory(contractName);

  const contract = await (await factory.deploy(...parameters)).deployed();

  return contract;
}

// Cache factory creation to avoid processing the compiled artifacts multiple times
export async function getFactory(contractName: string): Promise<ContractFactory> {
  let factory = factories[contractName];

  if (factory == undefined) {
    factory = await ethers.getContractFactory(contractName);
    factories[contractName] = factory;
  }

  return factory;
}
