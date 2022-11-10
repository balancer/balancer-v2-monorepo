import Task, { TaskMode } from '../../src/task';

export type GaugeAdderDeployment = {
  PreviousGaugeAdder: string;
  GaugeController: string;
};

const GaugeAdder = new Task('20220628-gauge-adder-v2', TaskMode.READ_ONLY);
const GaugeController = new Task('20220325-gauge-controller', TaskMode.READ_ONLY);

export default {
  mainnet: {
    GaugeController: GaugeController.output({ network: 'mainnet' }).GaugeController,
    PreviousGaugeAdder: GaugeAdder.output({ network: 'mainnet' }).GaugeAdder,
  },
  goerli: {
    GaugeController: GaugeController.output({ network: 'goerli' }).GaugeController,
    PreviousGaugeAdder: GaugeAdder.output({ network: 'goerli' }).GaugeAdder,
  },
};
