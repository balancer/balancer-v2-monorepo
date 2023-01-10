import { Contract } from 'ethers';
import Task, { TaskMode } from '../../../src/task';
import { TaskRunOptions } from '../../../src/types';
import { TRANSITION_END_BLOCK, TRANSITION_START_BLOCK, TimelockAuthorizerTransitionMigratorDeployment } from './input';
import { RoleData } from './input/types';
import { isEqual } from 'lodash';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as TimelockAuthorizerTransitionMigratorDeployment;

  const onChainRoles = await getTransitionRoles('mainnet', TRANSITION_START_BLOCK, TRANSITION_END_BLOCK);

  const onchainInputMatch = onChainRoles.every((cRole) => input.Roles.find((iRole) => isEqual(cRole, iRole)));
  const inputOnchainMatch = input.Roles.every((iRole) => onChainRoles.find((cRole) => isEqual(iRole, cRole)));
  const rolesMatch = onChainRoles.length === input.Roles.length && onchainInputMatch && inputOnchainMatch;
  if (!rolesMatch) {
    throw new Error('Input permissions do not match on-chain roles granted to old authorizer');
  }

  const args = [input.OldAuthorizer, input.NewAuthorizer, onChainRoles];
  await task.deployAndVerify('TimelockAuthorizerTransitionMigrator', args, from, force);
};

/**
 * Gets permissions granted to the old authorizer between two given blocks.
 * @param network Target chain name.
 * @param fromBlock Starting block; permissions granted before it will be filtered out.
 * @param toBlock End block; permissions granted after it will be filtered out.
 * @returns Promise of array with role data containing granted permissions.
 */
export async function getTransitionRoles(network: string, fromBlock: number, toBlock: number): Promise<RoleData[]> {
  const OldAuthorizerTask = new Task('20210418-authorizer', TaskMode.READ_ONLY);
  const oldAuthorizerAddress = OldAuthorizerTask.output({ network }).Authorizer;
  const oldAuthorizer: Contract = await OldAuthorizerTask.instanceAt('Authorizer', oldAuthorizerAddress);

  const eventFilter = oldAuthorizer.filters.RoleGranted();
  const events = await oldAuthorizer.queryFilter(eventFilter, fromBlock, toBlock);

  return events.map((e) => ({
    role: e.args?.role,
    grantee: String(e.args?.account).toLowerCase(),
    target: String(e.args?.sender).toLowerCase(),
  }));
}
