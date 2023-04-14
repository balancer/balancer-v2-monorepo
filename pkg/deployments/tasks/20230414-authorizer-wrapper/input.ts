import Task, { TaskMode } from '../../src/task';

export type AuthorizerWithAdaptorValidationDeployment = {
  Vault: string;
  Authorizer: string;
  AuthorizerAdaptor: string;
  AuthorizerAdaptorEntrypoint: string;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const Authorizer = new Task('20210418-authorizer', TaskMode.READ_ONLY);
const AuthorizerAdaptor = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY);
const AuthorizerAdaptorEntrypoint = new Task('20221124-authorizer-adaptor-entrypoint', TaskMode.READ_ONLY);

export default {
  Vault,
  Authorizer,
  AuthorizerAdaptor,
  AuthorizerAdaptorEntrypoint,
};
