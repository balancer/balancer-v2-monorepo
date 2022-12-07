import { Contract } from '@ethersproject/contracts';
import { Artifact } from 'hardhat/types';

/**
 * @dev Returns the task id and contract name for a canonical contract deployed on a specific network.
 * Throws if the address doesn't match any known Balancer deployment.
 * @param address Address of the contract to be fetched
 * @param network Name of the network looking the deployment for (e.g. mainnet,  polygon, goerli, etc)
 */
export function lookupBalancerContractByAddress(address: string, network: string): { task: string; name: string } {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const networkAddresses = require(getBalancerContractAddresses(network));
  const deploymentInfo = networkAddresses[address];
  if (deploymentInfo === undefined) {
    throw new Error(`Unable to connect ${address} to any Balancer deployment on ${network}`);
  }
  return deploymentInfo;
}

/**
 * @dev Creates an ethers Contract object for a canonical contract deployed on a specific network
 * @param task ID of the task to fetch the deployed contract
 * @param contract Name of the contract to be fetched
 * @param network Name of the network looking the deployment for (e.g. mainnet, polygon, goerli, etc)
 */
export async function getBalancerContract(task: string, contract: string, network: string): Promise<Contract> {
  const address = await getBalancerContractAddress(task, contract, network);
  return getBalancerContractAt(task, contract, address);
}

/**
 * @dev Creates an ethers Contract object from a dynamically created contract at a known address
 * @param task ID of the task to fetch the deployed contract
 * @param contract Name of the contract to be fetched
 * @param address Address of the contract to be fetched
 */
export async function getBalancerContractAt(task: string, contract: string, address: string): Promise<Contract> {
  const artifact = getBalancerContractArtifact(task, contract);
  return new Contract(address, artifact.abi);
}

/**
 * @dev Returns the contract's artifact from a specific task
 * @param task ID of the task to look the ABI of the required contract
 * @param contract Name of the contract to looking the ABI of
 */
export function getBalancerContractArtifact(task: string, contract: string): Artifact {
  return require(getBalancerContractArtifactPath(task, contract));
}

/**
 * @dev Returns the ABI for a contract from a specific task
 * @param task ID of the task to look the ABI of the required contract
 * @param contract Name of the contract to be fetched.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getBalancerContractAbi(task: string, contract: string): any[] {
  const artifact = getBalancerContractArtifact(task, contract);
  return artifact.abi;
}

/**
 * @deprecated
 * @dev Returns the contract's creation code of for a specific task
 * @param task ID of the task to look the creation code of the required contract
 * @param contract Name of the contract to looking the creation code of
 */
export function getBalancerContractBytecode(task: string, contract: string): string {
  const artifact = getBalancerContractArtifact(task, contract);
  return artifact.bytecode;
}

/**
 * @dev Returns the contract address of a deployed contract for a specific task on a network
 * @param task ID of the task looking the deployment for
 * @param contract Name of the contract to fetched the address of
 * @param network Name of the network looking the deployment for (e.g. mainnet, polygon, goerli, etc)
 */
export function getBalancerContractAddress(task: string, contract: string, network: string): string {
  const output = getBalancerDeployment(task, network);
  return output[contract];
}

/**
 * @dev Returns the deployment output for a specific task on a network
 * @param task ID of the task to look the deployment output of the required network
 * @param network Name of the network looking the deployment output for (e.g. mainnet, polygon, goerli, etc)
 */
export function getBalancerDeployment(task: string, network: string): { [key: string]: string } {
  return require(getBalancerDeploymentPath(task, network));
}

/**
 * @dev Returns the path of a contract's artifact from a specific task
 * @param task ID of the task to look the path of the artifact the required contract
 * @param contract Name of the contract to look the path of it's creation code
 */
function getBalancerContractArtifactPath(task: string, contract: string): string {
  return `@balancer-labs/v2-deployments/dist/tasks/${task}/artifact/${contract}.json`;
}

/**
 * @dev Returns the deployment path for a specific task on a network
 * @param task ID of the task to look the deployment path for the required network
 * @param network Name of the network looking the deployment path for (e.g. mainnet, polygon, goerli, etc)
 */
function getBalancerDeploymentPath(task: string, network: string): string {
  return `@balancer-labs/v2-deployments/dist/tasks/${task}/output/${network}.json`;
}

/**
 * @dev Returns the path for the list of Balancer contract addresses on a network
 * @param network Name of the network looking the deployment path for (e.g. mainnet, polygon, goerli, etc)
 */
function getBalancerContractAddresses(network: string): string {
  return `@balancer-labs/v2-deployments/dist/addresses/${network}.json`;
}
