import Task from '../../src/task';

export type GaugeSystemDeployment = {
  AuthorizerAdaptor: string;
  Vault: string;
};

const AuthorizerAdaptor = new Task('2022xxxx-authorizer-adaptor');
const Vault = new Task('20210418-vault');

export default {
  AuthorizerAdaptor,
  Vault,
};
