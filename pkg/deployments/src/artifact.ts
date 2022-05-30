import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { CompilerOutputContract } from 'hardhat/types';
import path from 'path';
import { findContractSourceName } from './buildinfo';
import logger from './logger';
import Task from './task';

/**
 * Reads each of the task's build-info files and extract the ABI and bytecode for the matching contract.
 */
export function extractArtifact(task: Task): void {
  const buildInfoDirectory = path.resolve(task.dir(), 'build-info');
  if (existsSync(buildInfoDirectory) && statSync(buildInfoDirectory).isDirectory()) {
    for (const buildInfoFileName of readdirSync(buildInfoDirectory)) {
      const contractName = path.parse(buildInfoFileName).name;
      const artifact = extractContractArtifact(task, contractName);
      writeContractArtifact(task, contractName, artifact);
    }
  }
}

/**
 * Checks that the ABI and bytecode files for `task` matches what is contained in the build-info file.
 * @param task - The task for which to check ABI and bytecode integrity.
 */
export function checkArtifact(task: Task): void {
  const buildInfoDirectory = path.resolve(task.dir(), 'build-info');
  if (existsSync(buildInfoDirectory) && statSync(buildInfoDirectory).isDirectory()) {
    for (const buildInfoFileName of readdirSync(buildInfoDirectory)) {
      const contractName = path.parse(buildInfoFileName).name;

      const expectedArtifact = extractContractArtifact(task, contractName);
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
function extractContractArtifact(task: Task, contractName: string): CompilerOutputContract {
  const buildInfo = task.buildInfo(contractName);

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
