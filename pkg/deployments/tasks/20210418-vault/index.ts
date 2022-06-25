import Task from '../../src/task';
import { VaultDeployment } from './input';
import { TaskRunOptions } from '../../src/types';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as VaultDeployment;
  const vaultArgs = [input.Authorizer, input.weth, input.pauseWindowDuration, input.bufferPeriodDuration];
  const vault = await task.deployAndVerify('Vault', vaultArgs, from, force);

  // The vault automatically also deploys the protocol fees collector: we must verify it
  const feeCollector = await vault.getProtocolFeesCollector();
  const feeCollectorArgs = [vault.address]; // See ProtocolFeesCollector constructor
  await task.verify('ProtocolFeesCollector', feeCollector, feeCollectorArgs);
  await task.save({ ProtocolFeesCollector: feeCollector });

  const helpersArgs = [vault.address];
  await task.deployAndVerify('BalancerHelpers', helpersArgs, from, force);
};
