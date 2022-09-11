<<<<<<< HEAD
import Task, { TaskMode } from '../../src/task';

export type GaugeAdderDeployment = {
  PreviousGaugeAdder: string;
  GaugeController: string;
};

const GaugeAdder = new Task('20220325-gauge-adder', TaskMode.READ_ONLY);
const GaugeController = new Task('20220325-gauge-controller', TaskMode.READ_ONLY);

export default {
  mainnet: {
    GaugeController,
    PreviousGaugeAdder: GaugeAdder.output({ network: 'mainnet' }).GaugeAdder,
  },
};
=======
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
>>>>>>> c3ccf89dac6f9b5fd6b8642ce84a0893998701e0
