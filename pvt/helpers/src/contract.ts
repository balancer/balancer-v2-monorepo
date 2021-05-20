import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { Artifacts } from 'hardhat/internal/artifacts';
import { Artifact } from 'hardhat/types';
import path from 'path';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ContractDeploymentParams = {
  from?: SignerWithAddress;
  args?: Array<unknown>;
};

// Deploys a contract, with optional `from` address and arguments.
// Local contracts are deployed by simply passing the contract name, contracts from other packages must be prefixed by
// the package name, without the @balancer-labs scope. Note that the full path is never required.
//
// For example, to deploy Vault.sol from the package that holds its artifacts, use `deploy('Vault')`. To deploy it from
// a different package, use `deploy('v2-vault/Vault')`, assuming the Vault's package is @balancer-labs/v2-vault.
export async function deploy(contract: string, { from, args }: ContractDeploymentParams = {}): Promise<Contract> {
  if (!args) args = [];
  if (!from) from = (await ethers.getSigners())[0];

  const artifact = await getArtifact(contract);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, from);
  const instance = await factory.deploy(...args);

  return deployedAt(contract, instance.address);
}

// Creates a contract object for a contract deployed at a known address. The `contract` argument follows the same rules
// as in `deploy`.
export async function deployedAt(contract: string, address: string): Promise<Contract> {
  const artifact = await getArtifact(contract);
  return ethers.getContractAt(artifact.abi, address);
}

function getArtifact(contract: string): Promise<Artifact> {
  let artifactsPath: string;
  if (!contract.includes('/')) {
    artifactsPath = path.resolve('./artifacts');
  } else {
    const packageName = `@balancer-labs/${contract.split('/')[0]}`;
    const packagePath = path.dirname(require.resolve(`${packageName}/package.json`));
    artifactsPath = `${packagePath}/artifacts`;
  }

  const artifacts = new Artifacts(artifactsPath);
  return artifacts.readArtifact(contract.split('/').slice(-1)[0]);
}
