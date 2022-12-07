import Task, { TaskMode } from '../../src/task';

export type VeBoostV2Deployment = {
  PreseededVotingEscrowDelegation: string;
  VotingEscrow: string;
};

const VotingEscrow = new Task('20220325-gauge-controller', TaskMode.READ_ONLY);
const PreseededVotingEscrowDelegation = new Task('20220530-preseeded-voting-escrow-delegation', TaskMode.READ_ONLY);

export default {
  VotingEscrow,
  PreseededVotingEscrowDelegation,
};
