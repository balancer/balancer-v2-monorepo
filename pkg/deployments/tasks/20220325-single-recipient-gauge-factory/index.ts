import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { SingleRecipientFactoryDelegationDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as SingleRecipientFactoryDelegationDeployment;

  const args = [input.BalancerMinter];
  const factory = await task.deployAndVerify('SingleRecipientGaugeFactory', args, from, force);

  const implementation = await factory.getGaugeImplementation();
  await task.verify('SingleRecipientGauge', implementation, [input.BalancerMinter]);
  await task.save({ SingleRecipientGauge: implementation });
};
