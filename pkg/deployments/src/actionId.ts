import { FunctionFragment, Interface } from '@ethersproject/abi';
import { Contract } from '@ethersproject/contracts';
import fs from 'fs';
import path from 'path';
import logger from './logger';
import Task, { TaskMode } from './task';

const ACTION_ID_DIRECTORY = path.join(__dirname, '../action-ids');

type ContractActionIdData = { useAdaptor: boolean; exampleContractAddress?: string; actionIds: Record<string, string> };

export async function saveActionIds(task: Task, contractName: string, contractAddress?: string): Promise<void> {
  const actionIdsDir = path.join(task.dir(), 'action-ids', task.network);
  if (!fs.existsSync(actionIdsDir)) fs.mkdirSync(actionIdsDir, { recursive: true });

  const { useAdaptor, actionIds } = await getActionIds(task, contractName, contractAddress);

  const filePath = path.join(ACTION_ID_DIRECTORY, `${task.network}.json`);
  const fileExists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();

  // Load the existing content if any exists.
  const newFileContents: Record<string, Record<string, ContractActionIdData>> = fileExists
    ? JSON.parse(fs.readFileSync(filePath).toString())
    : {};

  // Write the new entry.
  newFileContents[task.id] = newFileContents[task.id] ?? {};
  newFileContents[task.id][contractName] = { useAdaptor, exampleContractAddress: contractAddress, actionIds };

  fs.writeFileSync(filePath, JSON.stringify(newFileContents, null, 2));
}

export async function checkActionIds(task: Task): Promise<void> {
  const filePath = path.join(ACTION_ID_DIRECTORY, `${task.network}.json`);
  const fileExists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  if (fileExists) {
    const actionIdFileContents: Record<string, Record<string, ContractActionIdData>> = JSON.parse(
      fs.readFileSync(filePath).toString()
    );

    const taskActionIdData = actionIdFileContents[task.id];
    if (taskActionIdData === undefined) return;

    for (const [contractName, actionIdData] of Object.entries(taskActionIdData)) {
      const { useAdaptor: expectedUseAdaptor, actionIds: expectedActionIds } = await getActionIds(
        task,
        contractName,
        actionIdData.exampleContractAddress
      );

      const adaptorUsageMatch = actionIdData.useAdaptor === expectedUseAdaptor;
      const actionIdsMatch = Object.entries(expectedActionIds).every(
        ([signature, expectedActionId]) => actionIdData.actionIds[signature] === expectedActionId
      );
      if (adaptorUsageMatch && actionIdsMatch) {
        logger.success(`Verified recorded action IDs of contract '${contractName}' of task '${task.id}'`);
      } else {
        throw Error(
          `The recorded action IDs for '${contractName}' of task '${task.id}' does not match those calculated from onchain`
        );
      }
    }
  }
}

export async function getActionIds(
  task: Task,
  contractName: string,
  contractAddress?: string
): Promise<{ useAdaptor: boolean; actionIds: Record<string, string> }> {
  const artifact = task.artifact(contractName);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contractInterface = new Interface(artifact.abi as any);
  const contractFunctions = Object.entries(contractInterface.functions)
    .filter(([, func]) => ['nonpayable', 'payable'].includes(func.stateMutability))
    .sort(([sigA], [sigB]) => (sigA < sigB ? -1 : 1)); // Sort functions alphabetically.

  const { useAdaptor, actionIdSource } = await getActionIdSource(task, contractName, contractAddress);
  const actionIds = await getAdaptorActionIds(contractFunctions, actionIdSource);

  return { useAdaptor, actionIds };
}

async function getActionIdSource(
  task: Task,
  contractName: string,
  contractAddress?: string
): Promise<{ useAdaptor: boolean; actionIdSource: Contract }> {
  const artifact = task.artifact(contractName);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contractInterface = new Interface(artifact.abi as any);

  // Not all contracts use the Authorizer directly for authentication.
  // Only if it has the `getActionId` function does it use the Authorizer directly.
  // Contracts without this function either are permissionless or use another method such as the AuthorizerAdaptor.
  const contractIsAuthorizerAware = Object.values(contractInterface.functions).some(
    (func) => func.name === 'getActionId'
  );

  if (contractIsAuthorizerAware) {
    if (contractAddress) {
      return { useAdaptor: false, actionIdSource: await task.instanceAt(contractName, contractAddress) };
    } else {
      return { useAdaptor: false, actionIdSource: await task.deployedInstance(contractName) };
    }
  } else {
    const adaptorTask = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY, task.network);
    return { useAdaptor: true, actionIdSource: await adaptorTask.deployedInstance('AuthorizerAdaptor') };
  }
}

async function getAdaptorActionIds(
  contractFunctions: [string, FunctionFragment][],
  actionIdSource: Contract
): Promise<Record<string, string>> {
  const functionActionIds = await Promise.all(
    contractFunctions.map(async ([signature, contractFunction]) => {
      const functionSelector = Interface.getSighash(contractFunction);
      return [signature, await actionIdSource.getActionId(functionSelector)] as [string, string];
    })
  );

  return Object.fromEntries(functionActionIds);
}
