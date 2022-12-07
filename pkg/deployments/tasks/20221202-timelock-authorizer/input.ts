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
  Authorizer: string;
  AuthorizerAdaptorEntrypoint: string;
  Root: string;
  Roles: RoleData[];
  Granters: RoleData[];
  Revokers: RoleData[];
  ExecuteDelays: DelayData[];
  GrantDelays: DelayData[];
};

const Authorizer = new Task('20210418-authorizer', TaskMode.READ_ONLY);
const AuthorizerAdaptorEntrypoint = new Task('20221124-authorizer-adaptor-entrypoint', TaskMode.READ_ONLY);

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
    Root: '0x171C0fF5943CE5f133130436A29bF61E26516003',
    Roles: [],
    Granters: [],
    Revokers: [],
    ExecuteDelays: [],
    GrantDelays: [],
  },
};
