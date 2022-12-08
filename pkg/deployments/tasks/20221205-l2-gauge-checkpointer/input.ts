import Task, { TaskMode } from '../../src/task';

export type L2GaugeCheckpointerDeployment = {
  GaugeAdder: string;
};

const GaugeAdder = new Task('20220628-gauge-adder-v2', TaskMode.READ_ONLY);

export default {
  GaugeAdder,
};
