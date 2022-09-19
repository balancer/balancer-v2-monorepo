import Task, { TaskMode } from '../../../src/task';

export type FeeDistributorDeployment = {
  VotingEscrow: string;
  startTime: number;
};

const VotingEscrow = new Task('20220325-gauge-controller', TaskMode.READ_ONLY);

export default {
  VotingEscrow,
  mainnet: {
    startTime: 1649894400, // Thursday, April 14, 2022 00:00:00 UTC
  },
  goerli: {
    startTime: 1654732800, // Thursday, June 9, 2022 00:00:00 UTC
  },
  kovan: {
    startTime: 1654732800000, //  Thursday, June 9, 2022 00:00:00 UTC
  },
};
