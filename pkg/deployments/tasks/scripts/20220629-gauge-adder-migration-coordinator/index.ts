import Task from '../../../src/task';
import { TaskRunOptions } from '../../../src/types';
import { GaugeAdderMigrationCoordinatorDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as GaugeAdderMigrationCoordinatorDeployment;

  const args = [
    input.AuthorizerAdaptor,
    input.NewGaugeAdder,
    input.OldGaugeAdder,
    input.ArbitrumRootGaugeFactory,
    input.OptimismRootGaugeFactory,
    input.LiquidityMiningMultisig,
    input.GaugeCheckpointingMultisig,
  ];
  await task.deployAndVerify('GaugeAdderMigrationCoordinator', args, from, force);
};
