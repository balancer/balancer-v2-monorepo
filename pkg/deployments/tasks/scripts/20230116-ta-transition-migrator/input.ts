import { Contract } from 'ethers';
import Task, { TaskMode } from '../../../src/task';

// Start: block that contains the transaction that deployed the `TimelockAuthorizer`.
// https://etherscan.io/tx/0x20eb23f4393fd592240ec788f44fb9658cc6ef487b88398e9b76c910294c4eae
// End: close to the current block at the time the `TimelockAuthorizerTransitionMigrator` is deployed.
// It is expected that no roles were granted to the old authorizer after it.
const TRANSITION_START_BLOCK = 16085047;
export const TRANSITION_END_BLOCK = 16335800;

export type RoleData = {
  role: string;
  grantee: string;
  target: string;
};

export type TimelockAuthorizerTransitionMigratorDeployment = {
  OldAuthorizer: string;
  NewAuthorizer: string;
  Roles: Promise<RoleData[]>;
};

const OldAuthorizer = new Task('20210418-authorizer', TaskMode.READ_ONLY);
const oldAuthorizerAddress = OldAuthorizer.output({ network: 'mainnet' }).Authorizer;
const NewAuthorizer = new Task('20221202-timelock-authorizer', TaskMode.READ_ONLY);

const roles = getTransitionRoles(oldAuthorizerAddress, TRANSITION_START_BLOCK, TRANSITION_END_BLOCK);

export default {
  mainnet: {
    OldAuthorizer: oldAuthorizerAddress,
    NewAuthorizer: NewAuthorizer.output({ network: 'mainnet' }).TimelockAuthorizer,
    Roles: roles,
  },
};

async function getTransitionRoles(
  oldAuthorizerAddress: string,
  fromBlock: number,
  toBlock: number
): Promise<RoleData[]> {
  const OldAuthorizerTask = new Task('20210418-authorizer', TaskMode.READ_ONLY);
  const oldAuthorizer: Contract = await OldAuthorizerTask.instanceAt('Authorizer', oldAuthorizerAddress);

  const eventFilter = oldAuthorizer.filters.RoleGranted();
  const events = await oldAuthorizer.queryFilter(eventFilter, fromBlock, toBlock);

  return events.map((e) => ({
    role: e.args?.role,
    grantee: e.args?.account,
    target: e.args?.sender,
  }));
}
