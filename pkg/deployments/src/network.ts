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

export function saveContractDeploymentAddresses(task: Task): void {
  if (task.network === 'hardhat') return;

  const newEntries = Object.fromEntries(
    Object.entries(task.output({ ensure: false })).map(([name, address]) => [address, { task: task.id, name }])
  );

  const filePath = path.join(CONTRACT_ADDRESSES_DIRECTORY, `${task.network}.json`);
  const fileExists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();

  // Load the existing content if any exists.
  let newFileContents: Record<string, { task: string; name: string }> = fileExists
    ? JSON.parse(fs.readFileSync(filePath).toString())
    : {};
  // Write the task's entries into the file..
  newFileContents = {
    ...newFileContents,
    ...newEntries,
  };

  fs.writeFileSync(filePath, JSON.stringify(newFileContents, null, 2));
}
