import Task, { TaskMode } from '../../../src/task';

import { roles as mainnetRoles, delayedRoles as mainnetDelayedRoles } from './input/mainnet';
import { RoleData } from './input/types';

// Start: block that contains the transaction that deployed the `TimelockAuthorizer`.
// https://etherscan.io/tx/0x20eb23f4393fd592240ec788f44fb9658cc6ef487b88398e9b76c910294c4eae
// End: close to the current block at the time the `TimelockAuthorizerTransitionMigrator` is deployed.
// It is expected that no roles were granted to the old authorizer after it.
export const TRANSITION_START_BLOCK = 16085047;
export const TRANSITION_END_BLOCK = 16484500;

export type TimelockAuthorizerTransitionMigratorDeployment = {
  OldAuthorizer: string;
  NewAuthorizer: string;
  Roles: RoleData[];
  DelayedRoles: RoleData[];
};

const OldAuthorizer = new Task('20210418-authorizer', TaskMode.READ_ONLY);
const NewAuthorizer = new Task('20221202-timelock-authorizer', TaskMode.READ_ONLY);

export default {
  mainnet: {
    OldAuthorizer: OldAuthorizer.output({ network: 'mainnet' }).Authorizer,
    NewAuthorizer: NewAuthorizer.output({ network: 'mainnet' }).TimelockAuthorizer,
    Roles: mainnetRoles,
    DelayedRoles: mainnetDelayedRoles,
  },
};
