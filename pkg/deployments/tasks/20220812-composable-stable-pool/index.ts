import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { ComposableStablePoolDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as ComposableStablePoolDeployment;

  const args = [input.Vault, input.ProtocolFeePercentagesProvider];
  await task.deployAndVerify('StablePhantomPoolFactory', args, from, force);
};
