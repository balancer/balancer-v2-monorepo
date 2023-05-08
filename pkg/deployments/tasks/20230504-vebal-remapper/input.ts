import Task, { TaskMode } from '../../src/task';

export type VotingEscrowRemapperDeployment = {
  VotingEscrow: string;
  Vault: string;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const VotingEscrow = new Task('20220325-gauge-controller', TaskMode.READ_ONLY);

export default {
  VotingEscrow,
  Vault,
};
