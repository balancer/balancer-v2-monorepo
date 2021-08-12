import Task from '../../src/task';
import { VaultDeployment } from './input';
import { TaskRunOptions } from '../../src/types';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as VaultDeployment;
  const args = [input.Authorizer, input.weth, input.pauseWindowDuration, input.bufferPeriodDuration];
  await task.deployAndVerify('Vault', args, from, force);
};
