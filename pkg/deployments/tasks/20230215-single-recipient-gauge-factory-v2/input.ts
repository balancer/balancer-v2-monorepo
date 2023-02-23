import Task, { TaskMode } from '../../src/task';

export type SingleRecipientGaugeFactoryDeployment = {
  BalancerMinter: string;
  FactoryVersion: string;
  GaugeVersion: string;
};

const BalancerMinter = new Task('20220325-gauge-controller', TaskMode.READ_ONLY);
const BaseVersion = { version: 2, deployment: '20230215-single-recipient-gauge-factory-v2' };

export default {
  BalancerMinter,
  FactoryVersion: JSON.stringify({ name: 'SingleRecipientGaugeFactory', ...BaseVersion }),
  GaugeVersion: JSON.stringify({ name: 'SingleRecipientGauge', ...BaseVersion }),
};
