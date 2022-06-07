import { Interface } from '@ethersproject/abi';
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
  // Not all contracts use the Authorizer directly for authentication.
  // Only if it has the `getActionId` function does it use the Authorizer directly.
  // Contracts without this function either are permissionless or use another method such as the AuthorizerAdaptor.
  const contractIsAuthorizerAware = Object.values(contractInterface.functions).some(
    (func) => func.name === 'getActionId'
  );
  if (contractIsAuthorizerAware) {
    let contract: Contract;
    if (contractAddress) {
      contract = await task.instanceAt(contractName, contractAddress);
    } else {
      contract = await task.deployedInstance(contractName);
    }

    for (const [signature, contractFunction] of contractFunctions) {
      const functionSelector = Interface.getSighash(contractFunction);
      logger.log(`${signature}: ${await contract.getActionId(functionSelector)}`, '');
    }
  } else {
    const adaptorTask = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY, task.network);
    const authorizerAdaptor = await adaptorTask.deployedInstance('AuthorizerAdaptor');

    logger.warn(
      'This contract does not use the Authorizer for authentication. These action ids assume that you are calling these functions through the AuthorizerAdaptor\n'
    );

    for (const [signature, contractFunction] of contractFunctions) {
      const functionSelector = Interface.getSighash(contractFunction);
      logger.log(`${signature}: ${await authorizerAdaptor.getActionId(functionSelector)}`, '');
    }
  }
}
