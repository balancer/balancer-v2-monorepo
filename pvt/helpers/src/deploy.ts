import { ethers, network } from 'hardhat';
import { Dictionary } from 'lodash';
import { Contract, ContractFactory } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { NetworkConfig } from 'hardhat/types/config';

/* eslint-disable @typescript-eslint/no-explicit-any */

const factories: Dictionary<ContractFactory> = {};

export type ContractDeploymentParams = {
  from?: SignerWithAddress;
  args?: Array<unknown>;
};

export async function deploy(contract: string, { from, args }: ContractDeploymentParams = {}): Promise<Contract> {
  if (!args) args = [];
  if (!from) from = (await ethers.getSigners())[0];
  const factory = (await getFactory(contract)).connect(from);
  const instance = await factory.deploy(...args);
  return instance.deployed();
}

export async function getFactory(contractName: string): Promise<ContractFactory> {
  // Cache factory creation to avoid processing the compiled artifacts multiple times
  let factory = factories[contractName];

  if (factory == undefined) {
    const isPackage = contractName.includes('/');
    if (!isPackage) {
      factory = await ethers.getContractFactory(contractName);
    } else {
      const pieces = contractName.split('/');

      const isScoped = pieces[0].startsWith('@');
      const packageName = isScoped ? pieces.slice(0, 2).join('/') : pieces[0];
      const path = (isScoped ? pieces.slice(2, -1) : pieces.slice(1, -1)).join();
      const name = pieces.slice(-1)[0];

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { abi, bytecode } = require(`${packageName}/artifacts/contracts/${path}/${name}.sol/${name}.json`);

      const [defaultSigner] = await ethers.getSigners();
      factory = new ethers.ContractFactory(addGasToAbiMethodsIfNecessary(network.config, abi), bytecode, defaultSigner);
    }

    factories[contractName] = factory;
  }

  return factory;
}

// The following snippet is copy-pasted from
// https://github.com/nomiclabs/hardhat/blob/c015a18b836253d89167a25f49defdc6a384de7e/packages/hardhat-ethers/src/internal/helpers.ts#L310

// This helper adds a `gas` field to the ABI function elements if the network is set up to use a fixed amount of gas.
// This is done so that ethers doesn't automatically estimate gas limits on every call.
function addGasToAbiMethodsIfNecessary(networkConfig: NetworkConfig, abi: any[]): any[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { BigNumber } = require('ethers') as typeof ethers;

  if (networkConfig.gas === 'auto' || networkConfig.gas === undefined) {
    return abi;
  }

  // ethers adds 21000 to whatever the abi `gas` field has. This may lead to
  // OOG errors, as people may set the default gas to the same value as the
  // block gas limit, especially on Hardhat Network.
  // To avoid this, we substract 21000.
  // HOTFIX: We substract 1M for now. See: https://github.com/ethers-io/ethers.js/issues/1058#issuecomment-703175279
  const gasLimit = BigNumber.from(networkConfig.gas).sub(1000000).toHexString();

  const modifiedAbi: any[] = [];

  for (const abiElement of abi) {
    if (abiElement.type !== 'function') {
      modifiedAbi.push(abiElement);
      continue;
    }

    modifiedAbi.push({
      ...abiElement,
      gas: gasLimit,
    });
  }

  return modifiedAbi;
}
