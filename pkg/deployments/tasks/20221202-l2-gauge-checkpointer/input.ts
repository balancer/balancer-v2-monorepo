import Task, { TaskMode } from '../../src/task';

export type L2GaugeCheckpointerDeployment = {
  GaugeAdder: string;
  AdaptorEntrypoint: string;
};

const AdaptorEntrypoint = new Task('20221111-authorizer-adaptor-entrypoint', TaskMode.READ_ONLY);
const GaugeAdder = new Task('20221111-gauge-adder-v3', TaskMode.READ_ONLY);

export default {
  GaugeAdder,
  AdaptorEntrypoint,
};
