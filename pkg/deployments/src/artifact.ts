import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { Artifact, CompilerOutputContract } from 'hardhat/types';
import path from 'path';
import logger from './logger';
import Task from './task';

/**
 * Extracts the artifact for the matching contract.
 * @param task - The task for which to extract the artifacts.
 * @param file - Name of the file within `build-info` where to look for the contract. All files within `build-info`
 * directory will be checked if undefined.
 * @param contract - Name of the contract to match. Filename shall be used if undefined.
 */
export function extractArtifact(task: Task, file?: string, contract?: string): void {
  const buildInfoDirectory = path.resolve(task.dir(), 'build-info');
  if (existsSync(buildInfoDirectory) && statSync(buildInfoDirectory).isDirectory()) {
    if (file) {
      _extractArtifact(task, file, contract);
    } else {
      for (const buildInfoFileName of readdirSync(buildInfoDirectory)) {
        const fileName = path.parse(buildInfoFileName).name;
        _extractArtifact(task, fileName, contract);
      }
    }
  }
}

function _extractArtifact(task: Task, file: string, contract?: string) {
  contract = contract ?? file;
  const artifact = task.artifact(contract, file);
  writeContractArtifact(task, contract, artifact);
  logger.success(`Artifacts created for ${contract} contract found in ${file} build-info file`);
}

/**
 * Checks that the artifact files for `task` matches what is contained in the build-info file.
 * @param task - The task for which to check artifact integrity.
 */
export function checkArtifact(task: Task): void {
  const buildInfoDirectory = path.resolve(task.dir(), 'build-info');
  if (existsSync(buildInfoDirectory) && statSync(buildInfoDirectory).isDirectory()) {
    for (const buildInfoFileName of readdirSync(buildInfoDirectory)) {
      const fileName = path.parse(buildInfoFileName).name;
      const contractName = fileName;

      const expectedArtifact = task.artifact(contractName, fileName);
      const actualArtifact = readContractArtifact(task, contractName);

      const artifactMatch = JSON.stringify(actualArtifact) === JSON.stringify(expectedArtifact);
      if (artifactMatch) {
        logger.success(`Verified artifact integrity of contract '${contractName}' of task '${task.id}'`);
      } else {
        throw Error(
          `The artifact for contract '${contractName}' of task '${task.id}' does not match the contents of its build-info`
        );
      }
    }
  }
}

/**
 * Read the saved artifact for the contract `contractName`.
 */
function readContractArtifact(task: Task, contractName: string): Artifact | null {
  // Read contract ABI from file
  const artifactFilePath = path.resolve(task.dir(), 'artifact', `${contractName}.json`);
  const artifactFileExists = existsSync(artifactFilePath) && statSync(artifactFilePath).isFile();
  const artifact = artifactFileExists ? JSON.parse(readFileSync(artifactFilePath).toString()) : null;

  return artifact;
}

/**
 * Write the ABI and bytecode for the contract `contractName` to the ABI and bytecode files.
 */
function writeContractArtifact(task: Task, contractName: string, artifact: Artifact): void {
  const artifactDirectory = path.resolve(task.dir(), 'artifact');
  if (!existsSync(artifactDirectory)) {
    mkdirSync(artifactDirectory);
  }
  const abiFilePath = path.resolve(artifactDirectory, `${contractName}.json`);
  writeFileSync(abiFilePath, JSON.stringify(artifact, null, 2));
}

// The code below is copied from the `hardhat-core` package
// https://github.com/NomicFoundation/hardhat/blob/080a25a7e188311d7e56366e1dae669db81aa2d7/packages/hardhat-core/src/internal/artifacts.ts#L870-L918

const ARTIFACT_FORMAT_VERSION = 'hh-sol-artifact-1';

/**
 * Retrieves an artifact for the given `contractName` from the compilation output.
 *
 * @param sourceName The contract's source name.
 * @param contractName the contract's name.
 * @param contractOutput the contract's compilation output as emitted by `solc`.
 */
export function getArtifactFromContractOutput(
  sourceName: string,
  contractName: string,
  contractOutput: CompilerOutputContract
): Artifact {
  const evmBytecode = contractOutput.evm && contractOutput.evm.bytecode;
  let bytecode: string = evmBytecode && evmBytecode.object ? evmBytecode.object : '';

  if (bytecode.slice(0, 2).toLowerCase() !== '0x') {
    bytecode = `0x${bytecode}`;
  }

  const evmDeployedBytecode = contractOutput.evm && contractOutput.evm.deployedBytecode;
  let deployedBytecode: string = evmDeployedBytecode && evmDeployedBytecode.object ? evmDeployedBytecode.object : '';

  if (deployedBytecode.slice(0, 2).toLowerCase() !== '0x') {
    deployedBytecode = `0x${deployedBytecode}`;
  }

  const linkReferences = evmBytecode && evmBytecode.linkReferences ? evmBytecode.linkReferences : {};
  const deployedLinkReferences =
    evmDeployedBytecode && evmDeployedBytecode.linkReferences ? evmDeployedBytecode.linkReferences : {};

  return {
    _format: ARTIFACT_FORMAT_VERSION,
    contractName,
    sourceName,
    abi: contractOutput.abi,
    bytecode,
    deployedBytecode,
    linkReferences,
    deployedLinkReferences,
  };
}
