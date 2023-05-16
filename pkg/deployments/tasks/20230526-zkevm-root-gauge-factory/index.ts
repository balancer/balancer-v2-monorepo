import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { PolygonZkEVMRootGaugeFactoryDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as PolygonZkEVMRootGaugeFactoryDeployment;

  const args = [input.BalancerMinter, input.PolygonZkEVMBridge];

  const factory = await task.deployAndVerify('PolygonZkEVMRootGaugeFactory', args, from, force);

  const implementation = await factory.getGaugeImplementation();
  await task.verify('PolygonZkEVMRootGauge', implementation, [input.BalancerMinter, input.PolygonZkEVMBridge]);
  await task.save({ PolygonZkEVMRootGauge: implementation });
};
