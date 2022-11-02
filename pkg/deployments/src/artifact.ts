import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { CompilerOutputContract } from 'hardhat/types';
import path from 'path';
import { findContractSourceName } from './buildinfo';
import logger from './logger';
import Task from './task';

/**
 * Extracts the ABI and bytecode for the matching contract.
 * @param task - The task for which to extract the ABI and bytecode artifacts.
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
  const artifact = extractContractArtifact(task, file, contract);
  writeContractArtifact(task, contract, artifact);
  logger.success(`Artifacts created for ${contract} contract found in ${file} build-info file`);
}

/**
 * Checks that the ABI and bytecode files for `task` matches what is contained in the build-info file.
 * @param task - The task for which to check ABI and bytecode integrity.
 */
export function checkArtifact(task: Task): void {
  const buildInfoDirectory = path.resolve(task.dir(), 'build-info');
  if (existsSync(buildInfoDirectory) && statSync(buildInfoDirectory).isDirectory()) {
    for (const buildInfoFileName of readdirSync(buildInfoDirectory)) {
      const fileName = path.parse(buildInfoFileName).name;
      const contractName = fileName;

      const expectedArtifact = extractContractArtifact(task, fileName, contractName);
      const { abi, bytecode } = readContractABIAndBytecode(task, contractName);

      const bytecodeMatch = bytecode === expectedArtifact.evm.bytecode.object;
      const abiMatch = JSON.stringify(abi) === JSON.stringify(expectedArtifact.abi);
      if (bytecodeMatch && abiMatch) {
        logger.success(`Verified ABI and bytecode integrity of contract '${contractName}' of task '${task.id}'`);
      } else {
        throw Error(
          `The ABI and bytecode for contract '${contractName}' of task '${task.id}' does not match the contents of its build-info`
        );
      }
    }
  }
}

/**
 * Read the build-info file for the contract `contractName` and extract the ABI and bytecode.
 */
function extractContractArtifact(task: Task, fileName: string, contractName: string): CompilerOutputContract {
  const buildInfo = task.buildInfo(fileName);

  // Read ABI and bytecode from build-info file.
  const contractSourceName = findContractSourceName(buildInfo, contractName);
  return buildInfo.output.contracts[contractSourceName][contractName];
}

/**
 * Read the ABI and bytecode for the contract `contractName` from the ABI and bytecode files.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readContractABIAndBytecode(task: Task, contractName: string): { abi: any; bytecode: string } {
  // Read contract ABI from file
  const abiFilePath = path.resolve(task.dir(), 'abi', `${contractName}.json`);
  const abiFileExists = existsSync(abiFilePath) && statSync(abiFilePath).isFile();
  const abi = abiFileExists ? JSON.parse(readFileSync(abiFilePath).toString()) : [];

  // Read contract bytecode from file
  const bytecodeFilePath = path.resolve(task.dir(), 'bytecode', `${contractName}.json`);
  const bytecodeFileExists = existsSync(bytecodeFilePath) && statSync(bytecodeFilePath).isFile();
  const bytecode = bytecodeFileExists ? JSON.parse(readFileSync(bytecodeFilePath).toString()).creationCode : '';
  return { abi, bytecode };
}

/**
 * Write the ABI and bytecode for the contract `contractName` to the ABI and bytecode files.
 */
function writeContractArtifact(task: Task, contractName: string, artifact: CompilerOutputContract): void {
  // Save contract ABI to file
  if (artifact.abi.length > 0) {
    const abiDirectory = path.resolve(task.dir(), 'abi');
    if (!existsSync(abiDirectory)) {
      mkdirSync(abiDirectory);
    }
    const abiFilePath = path.resolve(abiDirectory, `${contractName}.json`);
    writeFileSync(abiFilePath, JSON.stringify(artifact.abi, null, 2));
  }

  // Save contract bytecode to file
  const bytecodeDirectory = path.resolve(task.dir(), 'bytecode');
  if (!existsSync(bytecodeDirectory)) {
    mkdirSync(bytecodeDirectory);
  }
  const bytecodeFilePath = path.resolve(bytecodeDirectory, `${contractName}.json`);
  writeFileSync(bytecodeFilePath, JSON.stringify({ creationCode: artifact.evm.bytecode.object }, null, 2));
}
