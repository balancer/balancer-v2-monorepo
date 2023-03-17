import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { GnosisRootGaugeFactoryDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as GnosisRootGaugeFactoryDeployment;

  const args = [input.BalancerMinter, input.GnosisBridge];

  const factory = await task.deployAndVerify('GnosisRootGaugeFactory', args, from, force);

  const implementation = await factory.getGaugeImplementation();
  await task.verify('GnosisRootGauge', implementation, [input.BalancerMinter, input.GnosisBridge]);
  await task.save({ GnosisRootGauge: implementation });
};
