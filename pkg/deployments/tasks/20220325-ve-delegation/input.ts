import Task from '../../src/task';

export type VotingEscrowDelegationDeployment = {
  Vault: string;
  AuthorizerAdaptor: string;
  VotingEscrow: string;
};

const Vault = new Task('20210418-vault');
const AuthorizerAdaptor = new Task('20220325-authorizer-adaptor');
const VotingEscrow = new Task('20220325-gauge-controller');

export default {
  Vault,
  AuthorizerAdaptor,
  VotingEscrow,
};
