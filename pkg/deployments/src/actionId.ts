import { FunctionFragment, Interface } from '@ethersproject/abi';
import { Contract } from '@ethersproject/contracts';
import logger from './logger';
import Task, { TaskMode } from './task';

export async function printActionIds(task: Task, contractName: string, contractAddress?: string): Promise<void> {
  const artifact = task.artifact(contractName);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contractInterface = new Interface(artifact.abi as any);
  const contractFunctions = Object.entries(contractInterface.functions).filter(([, func]) =>
    ['nonpayable', 'payable'].includes(func.stateMutability)
  );

  const actionIdSource = await getActionIdSource(task, contractName, contractAddress);
  const actionIdMap = await getAdaptorActionIds(contractFunctions, actionIdSource);

  for (const [signature, actionId] of Object.entries(actionIdMap)) {
    logger.log(`${signature}: ${actionId}`, '');
  }
}

async function getActionIdSource(task: Task, contractName: string, contractAddress?: string): Promise<Contract> {
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
      return task.instanceAt(contractName, contractAddress);
    } else {
      return task.deployedInstance(contractName);
    }
  } else {
    logger.warn(
      'This contract does not use the Authorizer for authentication. These action ids assume that you are calling these functions through the AuthorizerAdaptor\n'
    );

    const adaptorTask = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY, task.network);
    return adaptorTask.deployedInstance('AuthorizerAdaptor');
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
