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

export type TimelockAuthorizerDeployment = {
  Vault: string;
  Authorizer: string;
  Root: string;
  Roles: RoleData[];
  Granters: RoleData[];
  Revokers: RoleData[];
  ExecuteDelays: DelayData[];
  GrantDelays: DelayData[];
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const Authorizer = new Task('20210418-authorizer', TaskMode.READ_ONLY);

export default {
  Vault,
  Authorizer,
  mainnet: {
    Root: mainnetRoot,
    Roles: mainnetRoles,
    Granters: mainnetGranters,
    Revokers: mainnetRevokers,
    ExecuteDelays: mainnetExecuteDelays,
    GrantDelays: mainnetGrantDelays,
  },
  goerli: {
    Root: '0x171C0fF5943CE5f133130436A29bF61E26516003',
    Roles: [],
    Granters: [],
    Revokers: [],
    ExecuteDelays: [],
    GrantDelays: [],
  },
};
