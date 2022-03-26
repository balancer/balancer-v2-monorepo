import Task from '../../src/task';

export type GaugeAdderDeployment = {
  GaugeController: string;
};

const GaugeController = new Task('20220325-gauge-controller');

export default {
  GaugeController,
};
