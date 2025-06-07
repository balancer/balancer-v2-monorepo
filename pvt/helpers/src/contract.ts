import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { Artifacts } from 'hardhat/internal/artifacts';
import { Artifact } from 'hardhat/types';
import path from 'path';
import { Dictionary } from 'lodash';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ContractDeploymentParams = {
  from?: SignerWithAddress;
  args?: Array<unknown>;
  libraries?: Dictionary<string>;
};

// Deploys a contract, with optional `from` address and arguments.
// Local contracts are deployed by simply passing the contract name, contracts from other packages must be prefixed by
// the package name, without the @balancer-labs scope. Note that the full path is never required.
//
// For example, to deploy Vault.sol from the package that holds its artifacts, use `deploy('Vault')`. To deploy it from
// a different package, use `deploy('v2-vault/Vault')`, assuming the Vault's package is @balancer-labs/v2-vault.
export async function deploy(
  contract: string,
  { from, args, libraries }: ContractDeploymentParams = {}
): Promise<Contract> {
  if (!args) args = [];
  if (!from) from = (await ethers.getSigners())[0];

  const artifact = getArtifact(contract);

  const factory = await ethers.getContractFactoryFromArtifact(artifact, { signer: from, libraries });
  const instance = await factory.deploy(...args);

  return instance.deployed();
}

export async function deployVyper(
  contract: string,
  { from, args }: ContractDeploymentParams = {}
): Promise<Contract> {
  if (!args) args = [];
  if (!from) from = (await ethers.getSigners())[0];

  const artifact = getArtifact(contract);
  const transformedAbi = transformVyperAbi(artifact.abi);

  // Create factory with transformed ABI; Vyper can't handle arrays (tuples in the ABI).
  const factory = new ethers.ContractFactory(transformedAbi, artifact.bytecode, from);
  const instance = await factory.deploy(...args);

  return instance.deployed();
}

// Creates a contract object for a contract deployed at a known address. The `contract` argument follows the same rules
// as in `deploy`.
export async function deployedAt(contract: string, address: string): Promise<Contract> {
  const artifact = getArtifact(contract);
  return ethers.getContractAt(artifact.abi, address);
}

export function getArtifact(contract: string): Artifact {
  let artifactsPath: string;
  if (!contract.includes('/')) {
    artifactsPath = path.resolve('./artifacts');
  } else {
    const packageName = `@balancer-labs/${contract.split('/')[0]}`;
    const packagePath = path.dirname(require.resolve(`${packageName}/package.json`));
    artifactsPath = `${packagePath}/artifacts`;
  }

  const artifacts = new Artifacts(artifactsPath);
  return artifacts.readArtifactSync(contract.split('/').slice(-1)[0]);
}

// Function to transform Vyper ABI to ethers.js v5 compatible format
function transformVyperAbi(abi: any[]): any[] {
  return abi.map(item => {
    if (item.type === 'constructor' && item.inputs) {
      return {
        ...item,
        inputs: item.inputs.map((input: any) => transformInput(input))
      };
    }
    return item;
  });
}

function transformInput(input: any): any {
  if (input.type.includes('(') && input.type.includes(')')) {
    // Extract the tuple definition and array size
    const match = input.type.match(/\((.*?)\)(\[.*?\])?/);
    if (match) {
      const tupleTypes = match[1].split(',');
      const arraySize = match[2] || '';
      
      return {
        ...input,
        type: `tuple${arraySize}`,
        components: tupleTypes.map((type, index) => ({
          name: `field${index}`,
          type: type.trim()
        }))
      };
    }
  }
  return input;
}