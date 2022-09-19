import Task, { TaskMode } from '../../src/task';

export type GaugeAdderDeployment = {
  PreviousGaugeAdder: string;
  GaugeController: string;
};

const GaugeAdder = new Task('20220325-gauge-adder', TaskMode.READ_ONLY);
const GaugeController = new Task('20220325-gauge-controller', TaskMode.READ_ONLY);

export default {
  GaugeController,
  mainnet: {
    PreviousGaugeAdder: GaugeAdder.output({ network: 'mainnet' }).GaugeAdder,
  },
  goerli: {
    PreviousGaugeAdder: GaugeAdder.output({ network: 'goerli' }).GaugeAdder,
  },
};
