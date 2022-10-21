import Task, { TaskMode } from '../../src/task';

export type ManagedPoolDeployment = {
  Vault: string;
  ProtocolFeePercentagesProvider: string;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const ProtocolFeePercentagesProvider = new Task('20220725-protocol-fee-percentages-provider', TaskMode.READ_ONLY);

export default {
  Vault,
  ProtocolFeePercentagesProvider,
};
