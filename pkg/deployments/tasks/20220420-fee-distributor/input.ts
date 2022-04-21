import Task from '../../src/task';

export type FeeDistributorDeployment = {
  VotingEscrow: string;
  startTime: number;
};

const VotingEscrow = new Task('20220325-gauge-controller');

export default {
  VotingEscrow,
  mainnet: {
    startTime: 1649894400, // Thursday, April 14, 2022 00:00:00 UTC
  },
};
