import hre from 'hardhat';
import { Contract } from 'ethers';
import { getForkedNetwork } from '../../src/test';
import Task, { TaskMode } from '../../src/task';
import { DelayData, RoleData } from './input/types';
import {
  root as mainnetRoot,
  roles as mainnetRoles,
  granters as mainnetGranters,
  revokers as mainnetRevokers,
  executeDelays as mainnetExecuteDelays,
  grantDelays as mainnetGrantDelays,
} from './input/mainnet';
import { ANY_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

// Start: block that contains the transaction that deployed the `TimelockAuthorizer`.
// https://etherscan.io/tx/0x20eb23f4393fd592240ec788f44fb9658cc6ef487b88398e9b76c910294c4eae
// End: close to the current block at the time the `TimelockAuthorizerMigrator` is deployed.
// It is expected that no roles were granted to the old authorizer after it.
export const TRANSITION_START_BLOCK = 16085047;
export const TRANSITION_END_BLOCK = 16926916;

const Authorizer = new Task('20210418-authorizer', TaskMode.READ_ONLY);
const AuthorizerAdaptorEntrypoint = new Task('20221124-authorizer-adaptor-entrypoint', TaskMode.READ_ONLY);

export type TimelockAuthorizerDeployment = {
  Authorizer: string;
  AuthorizerAdaptorEntrypoint: string;
  Root: string;
  Roles: RoleData[];
  Granters: RoleData[];
  Revokers: RoleData[];
  ExecuteDelays: DelayData[];
  GrantDelays: DelayData[];
};

export async function getOnChainRoles(): Promise<RoleData[]> {
  const OldAuthorizerTask = new Task('20210418-authorizer', TaskMode.READ_ONLY);
  const oldAuthorizerAddress = OldAuthorizerTask.output({ network: getForkedNetwork(hre) }).Authorizer;
  const oldAuthorizer: Contract = await OldAuthorizerTask.instanceAt('Authorizer', oldAuthorizerAddress);

  // Filter already present roles
  const grantedRoles = await getTransitionRoles(
    getForkedNetwork(hre),
    TRANSITION_START_BLOCK,
    TRANSITION_END_BLOCK,
    'RoleGranted'
  );

  // remove all the roles not present onchain
  // because some added roles might be removed later
  const onchainRoles: RoleData[] = [];
  for (let role of mainnetRoles.concat(grantedRoles)) {
    if (await oldAuthorizer.canPerform(role.role, role.grantee, role.target)) {
      onchainRoles.push(role);
    }
  }

  return onchainRoles;
}

/**
 * Gets permissions granted to the old authorizer between two given blocks.
 * @param network Target chain name.
 * @param fromBlock Starting block; permissions granted before it will be filtered out.
 * @param toBlock End block; permissions granted after it will be filtered out.
 * @returns Promise of array with role data containing granted permissions.
 */
export async function getTransitionRoles(
  network: string,
  fromBlock: number,
  toBlock: number,
  event: string
): Promise<RoleData[]> {
  const OldAuthorizerTask = new Task('20210418-authorizer', TaskMode.READ_ONLY);
  const oldAuthorizerAddress = OldAuthorizerTask.output({ network }).Authorizer;
  const oldAuthorizer: Contract = await OldAuthorizerTask.instanceAt('Authorizer', oldAuthorizerAddress);

  const eventFilter = oldAuthorizer.filters[event]();
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

export default {
  Authorizer,
  AuthorizerAdaptorEntrypoint,
  mainnet: {
    Root: mainnetRoot,
    Roles: mainnetRoles,
    Granters: mainnetGranters,
    Revokers: mainnetRevokers,
    ExecuteDelays: mainnetExecuteDelays,
    GrantDelays: mainnetGrantDelays,
  },
  goerli: {
    Root: '',
    Roles: [],
    Granters: [],
    Revokers: [],
    ExecuteDelays: [],
    GrantDelays: [],
  },
};
