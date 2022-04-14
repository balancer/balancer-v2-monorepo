import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { PolygonRootGaugeFactoryDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as PolygonRootGaugeFactoryDeployment;

  const args = [input.BalancerMinter, input.PolygonRootChainManager, input.PolygonERC20Predicate];
  await task.deployAndVerify('PolygonRootGaugeFactory', args, from, force);
};
