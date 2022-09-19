import fs from 'fs';
import path from 'path';

import { Network } from './types';

const DEPLOYMENT_TXS_DIRECTORY = path.resolve(__dirname, '../deployment-txs');
const VERIFIED_NETWORKS = ['mainnet', 'polygon', 'arbitrum', 'optimism', 'goerli'];

export async function saveContractDeploymentTransactionHash(
  deployedAddress: string,
  deploymentTransactionHash: string,
  network: Network
): Promise<void> {
  // We only save transactions hashes for a subset of networks.
  if (!VERIFIED_NETWORKS.includes(network)) return;

  const filePath = path.join(DEPLOYMENT_TXS_DIRECTORY, `${network}.json`);
  const fileExists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();

  // Load the existing content if any exists.
  const newFileContents: Record<string, string> = fileExists ? JSON.parse(fs.readFileSync(filePath).toString()) : {};

  // Write the new entry.
  newFileContents[deployedAddress] = deploymentTransactionHash;

  fs.writeFileSync(filePath, JSON.stringify(newFileContents, null, 2));
}

export async function getContractDeploymentTransactionHash(deployedAddress: string, network: Network): Promise<string> {
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
