import Task, { TaskMode } from '../../src/task';

export type GaugeAdderDeployment = {
  GaugeController: string;
  AuthorizerAdaptorEntrypoint: string;
};

const GaugeController = new Task('20220325-gauge-controller', TaskMode.READ_ONLY);
const AuthorizerAdaptorEntrypoint = new Task('20221124-authorizer-adaptor-entrypoint', TaskMode.READ_ONLY);

export default {
  AuthorizerAdaptorEntrypoint,
  mainnet: {
    GaugeController,
  },
  goerli: {
    GaugeController,
  },
};
