import hre from 'hardhat';
import { Contract } from 'ethers';
import { getForkedNetwork } from '../../src/test';
import Task, { TaskMode } from '../../src/task';
import { DelayData, RoleData } from './input/types';
import { ANY_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

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
  TRANSITION_START_BLOCK: number;
  TRANSITION_END_BLOCK: number;
};

export async function getOnChainRoles(roles: RoleData[], start: number, end: number): Promise<RoleData[]> {
  const OldAuthorizerTask = new Task('20210418-authorizer', TaskMode.READ_ONLY);
  const oldAuthorizerAddress = OldAuthorizerTask.output({ network: getForkedNetwork(hre) }).Authorizer;
  const oldAuthorizer: Contract = await OldAuthorizerTask.instanceAt('Authorizer', oldAuthorizerAddress);

  // Filter already present roles
  const grantedRoles = await getTransitionRoles(getForkedNetwork(hre), start, end, 'RoleGranted');

  // remove all the roles not present onchain
  // because some added roles might be removed later
  const onchainRoles: RoleData[] = [];
  for (let role of roles.concat(grantedRoles)) {
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

export default {
  Authorizer,
  AuthorizerAdaptorEntrypoint,
  networks: ['mainnet', 'goerli'],
  mainnet: require('./input/mainnet'),
  goerli: require('./input/goerli'),
};
