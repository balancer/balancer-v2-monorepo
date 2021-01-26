import { Contract, ContractFactory, Signer } from 'ethers';
import { ethers } from 'hardhat';
import { Dictionary } from 'lodash';

const factories: Dictionary<ContractFactory> = {};

export async function deploy(
  contractName: string,
  { from, args }: { from?: Signer; args: Array<unknown> }
): Promise<Contract> {
  let factory = await getFactory(contractName);

  if (from) {
    factory = factory.connect(from);
  }

  const instance = await factory.deploy(...args);
  return instance.deployed();
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
