import Task from '../../src/task';
import { VaultDeployment } from './input';
import { TaskRunOptions } from '../../src/types';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as VaultDeployment;
  const vaultArgs = [input.Authorizer, input.weth, input.pauseWindowDuration, input.bufferPeriodDuration];
  await task.deployAndVerify('Vault', vaultArgs, from, force);

  const vault = await task.deployedInstance('Vault');
  const helpersArgs = [vault.address];
  await task.deployAndVerify('BalancerHelpers', helpersArgs, from, force);
};
