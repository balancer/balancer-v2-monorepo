import Task, { TaskMode } from '../../src/task';
import { DelayData, RoleData } from './input/types';

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

export default {
  Authorizer,
  AuthorizerAdaptorEntrypoint,
  networks: ['goerli'],
  mainnet: require('./input/mainnet'),
  goerli: require('./input/goerli'),
};
