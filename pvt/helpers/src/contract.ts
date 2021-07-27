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

  const artifact = await getArtifact(contract);
  if (libraries !== undefined) artifact.bytecode = linkBytecode(artifact, libraries);

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

export async function getArtifact(contract: string): Promise<Artifact> {
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

// From https://github.com/nomiclabs/hardhat/issues/611#issuecomment-638891597, temporary workaround until
// https://github.com/nomiclabs/hardhat/issues/1716 is addressed.
function linkBytecode(artifact: Artifact, libraries: Dictionary<string>): string {
  let bytecode = artifact.bytecode;

  for (const [, fileReferences] of Object.entries(artifact.linkReferences)) {
    for (const [libName, fixups] of Object.entries(fileReferences)) {
      const addr = libraries[libName];
      if (addr === undefined) {
        continue;
      }

      for (const fixup of fixups) {
        bytecode =
          bytecode.substr(0, 2 + fixup.start * 2) +
          addr.substr(2) +
          bytecode.substr(2 + (fixup.start + fixup.length) * 2);
      }
    }
  }

  return bytecode;
}
