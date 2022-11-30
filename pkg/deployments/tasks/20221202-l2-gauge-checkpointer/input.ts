import Task, { TaskMode } from '../../src/task';

export type L2GaugeCheckpointerDeployment = {
  //GaugeAdder: string;
  AuthorizerAdaptorEntrypoint: string;
};

const AuthorizerAdaptorEntrypoint = new Task('20221124-authorizer-adaptor-entrypoint', TaskMode.READ_ONLY);
//TODO: remove when gauge-adder deployed
//const GaugeAdder = new Task('20221202-gauge-adder-v3', TaskMode.READ_ONLY);

export default {
  //GaugeAdder,
  AuthorizerAdaptorEntrypoint,
};
