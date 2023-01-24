import { Contract } from 'ethers';
import Task, { TaskMode } from '../../../src/task';
import { TaskRunOptions } from '../../../src/types';
import { TRANSITION_END_BLOCK, TRANSITION_START_BLOCK, TimelockAuthorizerTransitionMigratorDeployment } from './input';
import { RoleData } from './input/types';
import { ANY_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { excludedRoles } from './input/mainnet';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as TimelockAuthorizerTransitionMigratorDeployment;

  const inputRoles = [...input.Roles, ...input.DelayedRoles];

  // Filter excluded roles in inputs file from on-chain roles.
  const onChainRoles = (await getTransitionRoles('mainnet', TRANSITION_START_BLOCK, TRANSITION_END_BLOCK)).filter(
    (role) => !excludedRoles.find((excludedRole) => isRoleEqual(excludedRole, role))
  );

  const onchainInputMatch = onChainRoles.every((cRole) => inputRoles.find((iRole) => isRoleEqual(cRole, iRole)));
  const inputOnchainMatch = inputRoles.every((iRole) => onChainRoles.find((cRole) => isRoleEqual(iRole, cRole)));
  const rolesMatch = onChainRoles.length === inputRoles.length && onchainInputMatch && inputOnchainMatch;

  if (!rolesMatch) {
    throw new Error('Input permissions do not match on-chain roles granted to old authorizer');
  }

  const args = [input.OldAuthorizer, input.NewAuthorizer, inputRoles];
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

  // Old authorizer doesn't take into account the target, and on-chain permissions use DAO multisig address as a
  // sentinel value for the target.
  return events.map((e) => ({
    role: e.args?.role,
    grantee: e.args?.account,
    target: ANY_ADDRESS,
  }));
}

/**
 * Compare two `RoleData` objects by role and grantee, dismissing target.
 * On-chain roles use DAO multisig as a sentinel value since the old authorizer doesn't take the target address into
 * account. In other words, in the old authorizer all permissions are granted 'everywhere' no matter what the target is.
 * Therefore, we skip the target when comparing roles.
 * @param r1 First object to compare.
 * @param r2 Second object to compare.
 * @returns True if role and grantee (caps insensitive) are equal, false otherwise.
 */
function isRoleEqual(r1: RoleData, r2: RoleData): boolean {
  return r1.role === r2.role && r1.grantee.toLowerCase() === r2.grantee.toLowerCase();
}
