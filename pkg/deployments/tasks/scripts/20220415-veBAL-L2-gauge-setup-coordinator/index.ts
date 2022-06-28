import Task from '../../../src/task';
import { TaskRunOptions } from '../../../src/types';
import { veBALL2GaugeSetupCoordinatorDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as veBALL2GaugeSetupCoordinatorDeployment;

  const args = [
    input.AuthorizerAdaptor,
    input.VotingEscrow,
    input.GaugeAdder,
    input.EthereumGaugeFactory,
    input.PolygonRootGaugeFactory,
    input.ArbitrumRootGaugeFactory,
  ];
  await task.deployAndVerify('veBALL2GaugeSetupCoordinator', args, from, force);
};
