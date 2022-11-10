import Task from '../../../src/task';
import { TaskRunOptions } from '../../../src/types';
import { GaugeAdderMigrationCoordinatorDeployment } from './input';

export default async (task: Task, { force, from, extra, extra2 }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as GaugeAdderMigrationCoordinatorDeployment;

  const NewGaugeAdder = extra as string;
  const AuthorizerAdaptor = extra2 as string;

  const args = [
    AuthorizerAdaptor,
    NewGaugeAdder,
    input.OldGaugeAdder,
    input.ArbitrumRootGaugeFactory,
    input.OptimismRootGaugeFactory,
    input.LiquidityMiningMultisig,
    input.GaugeCheckpointingMultisig,
  ];
  await task.deployAndVerify('GaugeAdderMigrationCoordinator', args, from, force);
};
