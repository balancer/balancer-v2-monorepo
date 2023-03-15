import { FunctionFragment, Interface } from '@ethersproject/abi';
import { Contract } from '@ethersproject/contracts';
import fs from 'fs';
import { padEnd } from 'lodash';
import path from 'path';
import logger from './logger';
import Task, { TaskMode } from './task';

export const ACTION_ID_DIRECTORY = path.join(__dirname, '../action-ids');

export type ContractActionIdData = { useAdaptor: boolean; factoryOutput?: string; actionIds: Record<string, string> };
type ActionIdInfo = {
  taskId: string;
  contractName: string;
  signature: string;
  useAdaptor: boolean;
};

function safeReadJsonFile<T>(filePath: string): Record<string, T> {
  const fileExists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();

  return fileExists ? JSON.parse(fs.readFileSync(filePath).toString()) : {};
}

export function getTaskActionIds(task: Task): Record<string, ContractActionIdData> {
  const filePath = path.join(ACTION_ID_DIRECTORY, task.network, 'action-ids.json');
  const actionIdFileContents = safeReadJsonFile<Record<string, ContractActionIdData>>(filePath);
  return actionIdFileContents[task.id];
}

export async function saveActionIds(task: Task, contractName: string, factoryOutput?: string): Promise<void> {
  logger.log(`Generating action IDs for ${contractName} of ${task.id}`, '');

  const { useAdaptor, actionIds } = await getActionIds(task, contractName, factoryOutput);

  const actionIdsDir = path.join(ACTION_ID_DIRECTORY, task.network);
  if (!fs.existsSync(actionIdsDir)) fs.mkdirSync(actionIdsDir, { recursive: true });

  const filePath = path.join(actionIdsDir, 'action-ids.json');

  // Load the existing content if any exists.
  const newFileContents = safeReadJsonFile<Record<string, ContractActionIdData>>(filePath);

  // Write the new entry.
  newFileContents[task.id] = newFileContents[task.id] ?? {};
  newFileContents[task.id][contractName] = { useAdaptor, factoryOutput, actionIds };

  fs.writeFileSync(filePath, JSON.stringify(newFileContents, null, 2));
}

export async function checkActionIds(task: Task): Promise<void> {
  const taskActionIdData = getTaskActionIds(task);
  if (taskActionIdData === undefined) return;

  for (const [contractName, actionIdData] of Object.entries(taskActionIdData)) {
    const { useAdaptor: expectedUseAdaptor, actionIds: expectedActionIds } = await getActionIds(
      task,
      contractName,
      actionIdData.factoryOutput
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

export function checkActionIdUniqueness(network: string): void {
  const actionIdsDir = path.join(ACTION_ID_DIRECTORY, network);

  const filePath = path.join(actionIdsDir, 'action-ids.json');
  const actionIdFileContents = safeReadJsonFile<Record<string, ContractActionIdData>>(filePath);

  const duplicateActionIdsMapping = getDuplicateActionIds(actionIdFileContents);

  const expectedCollisionsFilePath = path.join(actionIdsDir, 'expected-collisions.json');
  const expectedDuplicateActionIdsMapping =
    safeReadJsonFile<Record<string, ContractActionIdData>>(expectedCollisionsFilePath);

  if (JSON.stringify(duplicateActionIdsMapping) === JSON.stringify(expectedDuplicateActionIdsMapping)) {
    logger.success(`Verified that no contracts unexpectedly share action IDs for ${network}`);
  } else {
    for (const [actionId, instances] of Object.entries(duplicateActionIdsMapping)) {
      if (JSON.stringify(instances) === JSON.stringify(expectedDuplicateActionIdsMapping[actionId])) {
        // We expect some collisions of actionIds for cases where contracts share the same signature,
        // such as those using the AuthorizerAdaptor. If the collisions *exactly* match those in the
        // expected list, we can ignore them.
        continue;
      }

      // If there are unexpected collisions while running `save-action-ids`, this will generate detailed
      // warning messages. Follow the instructions below to update the `expected-collisions` file.
      logger.warn(`${instances.length} contracts share the action ID: ${actionId}`);
      for (const [index, actionIdInfo] of instances.entries()) {
        const prefix = `  ${index + 1}: ${actionIdInfo.contractName}::${actionIdInfo.signature}`;
        logger.warn(`${padEnd(prefix, 100)}(${actionIdInfo.taskId})`);
      }
    }

    // Write a file called `updated-expected-collisions`, with new entries added to resolve the warnings.
    //
    // If there is no `expected-collisions` file for this network, simply review the new file to ensure the
    // additions are valid, then rename `updated-expected-collisions` to `expected-collisions`.
    // If there is already an`expected-collisions` file, check the diff, then replace the old file with this one.
    //
    // Never make manual changes to the `expected-collisions` file, as this might result in "unsorted"
    // entries that cause `save-action-ids` to fail with no warnings.
    //
    // After renaming or replacing the collisions file, running `save-action-ids` again should
    // produce no warnings.
    fs.writeFileSync(
      path.join(actionIdsDir, 'updated-expected-collisions.json'),
      JSON.stringify(duplicateActionIdsMapping, null, 2)
    );
    throw Error(`There exist two duplicated action IDs across two separate contracts`);
  }
}

export async function getActionIds(
  task: Task,
  contractName: string,
  factoryOutput?: string
): Promise<{ useAdaptor: boolean; actionIds: Record<string, string> }> {
  const artifact = task.artifact(contractName);

  const { ignoredFunctions } = safeReadJsonFile<string[]>(path.join(ACTION_ID_DIRECTORY, 'ignored-functions.json'));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contractInterface = new Interface(artifact.abi as any);
  const contractFunctions = Object.entries(contractInterface.functions)
    .filter(([, func]) => ['nonpayable', 'payable'].includes(func.stateMutability))
    .filter(([, func]) => !ignoredFunctions.includes(func.format()))
    .sort(([sigA], [sigB]) => (sigA < sigB ? -1 : 1)); // Sort functions alphabetically.

  const { useAdaptor, actionIdSource } = await getActionIdSource(task, contractName, factoryOutput);
  const actionIds = await getActionIdsFromSource(contractFunctions, actionIdSource);

  return { useAdaptor, actionIds };
}

async function getActionIdSource(
  task: Task,
  contractName: string,
  factoryOutput?: string
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
    if (factoryOutput) {
      await checkFactoryOutput(task, contractName, factoryOutput);
      return { useAdaptor: false, actionIdSource: await task.instanceAt(contractName, factoryOutput) };
    } else {
      return { useAdaptor: false, actionIdSource: await task.deployedInstance(contractName) };
    }
  } else {
    const adaptorTask = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY, task.network);
    return { useAdaptor: true, actionIdSource: await adaptorTask.deployedInstance('AuthorizerAdaptor') };
  }
}

async function getActionIdsFromSource(
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

function getDuplicateActionIds(
  actionIdFileContents: Record<string, Record<string, ContractActionIdData>>
): Record<string, ActionIdInfo[]> {
  // Reverse the mapping of `contractName -> signature -> actionId` to be `actionId -> [contractName, signature][]`.
  // This simplifies checking for duplicate actionIds to just reading the length of the arrays.
  const actionIdsMapping: Record<string, ActionIdInfo[]> = Object.entries(actionIdFileContents)
    .flatMap(([taskId, taskData]) =>
      Object.entries(taskData).flatMap(([contractName, contractData]) =>
        Object.entries(contractData.actionIds).map<[string, ActionIdInfo]>(([signature, actionId]) => [
          actionId,
          { taskId, contractName, signature, useAdaptor: contractData.useAdaptor },
        ])
      )
    )
    .reduce((acc: Record<string, ActionIdInfo[]>, [actionId, actionIdInfo]) => {
      acc[actionId] = acc[actionId] ?? [];
      acc[actionId].push(actionIdInfo);
      return acc;
    }, {});

  const duplicateActionIdsMapping = Object.fromEntries(
    Object.entries(actionIdsMapping).filter(([, instances]) => instances.length > 1)
  );

  return duplicateActionIdsMapping;
}

async function checkFactoryOutput(task: Task, contractName: string, factoryOutput: string) {
  // We must check that the factory output is actually an instance of the expected contract type. This is
  // not trivial due to usage of immutable and lack of knowledge of constructor arguments. However, this scenario
  // only arises with Pools created from factories, all of which share a useful property: their factory contract
  // name is <contractName>Factory, and they all have a function called 'isPoolFromFactory' we can use for this.

  const factory = await task.deployedInstance(`${contractName}Factory`);
  if (!(await factory.isPoolFromFactory(factoryOutput))) {
    throw Error(`The contract at ${factoryOutput} is not an instance of a ${contractName}`);
  }
}
