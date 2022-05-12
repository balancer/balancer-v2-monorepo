import Task, { TaskMode } from '../../src/task';

export type VotingEscrowDelegationDeployment = {
  Vault: string;
  AuthorizerAdaptor: string;
  VotingEscrow: string;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const AuthorizerAdaptor = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY);
const VotingEscrow = new Task('20220325-gauge-controller', TaskMode.READ_ONLY);

export default {
  Vault,
  AuthorizerAdaptor,
  VotingEscrow,
};
