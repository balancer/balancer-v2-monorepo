import Task, { TaskMode } from '../../src/task';

export type FeeDistributorDeployment = {
  VotingEscrow: string;
  startTime: number;
};

const VotingEscrow = new Task('20220325-gauge-controller', TaskMode.READ_ONLY);

export default {
  VotingEscrow,
  mainnet: {
    startTime: 1657756800, // Thursday, July 14 2022 00:00:00 UTC
  },
  goerli: {
    startTime: 1657756800, // Thursday, July 14 2022 00:00:00 UTC
  },
};
