import fs from 'fs';
import path from 'path';
import Task from './task';

import { Network } from './types';

const DEPLOYMENT_TXS_DIRECTORY = path.resolve(__dirname, '../deployment-txs');
const CONTRACT_ADDRESSES_DIRECTORY = path.resolve(__dirname, '../addresses');

export function saveContractDeploymentTransactionHash(
  deployedAddress: string,
  deploymentTransactionHash: string,
  network: Network
): void {
  if (network === 'hardhat') return;

  const filePath = path.join(DEPLOYMENT_TXS_DIRECTORY, `${network}.json`);
  const fileExists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();

  // Load the existing content if any exists.
  const newFileContents: Record<string, string> = fileExists ? JSON.parse(fs.readFileSync(filePath).toString()) : {};

  // Write the new entry.
  newFileContents[deployedAddress] = deploymentTransactionHash;

  fs.writeFileSync(filePath, JSON.stringify(newFileContents, null, 2));
}

export function getContractDeploymentTransactionHash(deployedAddress: string, network: Network): string {
  const filePath = path.join(DEPLOYMENT_TXS_DIRECTORY, `${network}.json`);
  const fileExists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  if (!fileExists) {
    throw Error(`Could not find file for deployment transaction hashes for network '${network}'`);
  }

  const deploymentTxs: Record<string, string> = JSON.parse(fs.readFileSync(filePath).toString());
  const txHash = deploymentTxs[deployedAddress];
  if (txHash === undefined) {
    throw Error(`No transaction hash for contract ${deployedAddress} on network '${network}'`);
  }

  return txHash;
}

export function getContractDeploymentByAddress(
  deployedAddress: string,
  network: Network
): { task: string; name: string } {
  const filePath = path.join(CONTRACT_ADDRESSES_DIRECTORY, `${network}.json`);
  const fileExists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  if (!fileExists) {
    throw Error(`Could not find file for contract addresses for network '${network}'`);
  }

  // Load the existing content if any exists.
  const newFileContents: Record<string, { task: string; name: string }> = JSON.parse(
    fs.readFileSync(filePath).toString()
  );

  if (newFileContents[deployedAddress] === undefined) {
    throw Error(`Could not find file for contract addresses for network '${network}'`);
  }

  return newFileContents[deployedAddress];
}

export function saveContractDeploymentAddress(
  task: Task,
  contractName: string,
  deployedAddress: string,
  network: Network
): void {
  if (network === 'hardhat') return;

  const filePath = path.join(CONTRACT_ADDRESSES_DIRECTORY, `${network}.json`);
  const fileExists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();

  // Load the existing content if any exists.
  const newFileContents: Record<string, { task: string; name: string }> = fileExists
    ? JSON.parse(fs.readFileSync(filePath).toString())
    : {};

  // Write the new entry.
  newFileContents[deployedAddress] = { task: task.id, name: contractName };

  fs.writeFileSync(filePath, JSON.stringify(newFileContents, null, 2));
}
