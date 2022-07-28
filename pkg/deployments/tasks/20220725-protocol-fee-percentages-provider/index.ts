import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { ProtocolFeePercentagesProviderDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as ProtocolFeePercentagesProviderDeployment;

  const args = [input.Vault, input.maxYieldValue, input.maxAUMValue];
  await task.deployAndVerify('ProtocolFeePercentagesProvider', args, from, force);
};
