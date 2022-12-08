import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { OptimismRootGaugeFactoryDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as OptimismRootGaugeFactoryDeployment;

  const args = [input.Vault, input.BalancerMinter, input.L1StandardBridge, input.OptimismBAL, input.GasLimit];

  const factory = await task.deployAndVerify('OptimismRootGaugeFactory', args, from, force);

  const implementation = await factory.getGaugeImplementation();
  await task.verify('OptimismRootGauge', implementation, [
    input.BalancerMinter,
    input.L1StandardBridge,
    input.OptimismBAL,
  ]);
  await task.save({ OptimismRootGauge: implementation });
};
