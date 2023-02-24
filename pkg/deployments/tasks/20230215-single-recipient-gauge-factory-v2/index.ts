import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { SingleRecipientGaugeFactoryDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as SingleRecipientGaugeFactoryDeployment;

  const args = [input.BalancerMinter, input.FactoryVersion, input.GaugeVersion];
  const factory = await task.deployAndVerify('SingleRecipientGaugeFactory', args, from, force);

  const implementation = await factory.getGaugeImplementation();
  await task.verify('SingleRecipientGauge', implementation, [input.BalancerMinter]);
  await task.save({ SingleRecipientGauge: implementation });
};
