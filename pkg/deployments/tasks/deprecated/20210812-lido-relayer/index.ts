import Task from '../../../src/task';
import { TaskRunOptions } from '../../../src/types';
import { LidoRelayerDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as LidoRelayerDeployment;

  const relayerArgs = [input.Vault, input.wstETH];
  await task.deployAndVerify('LidoRelayer', relayerArgs, from, force);
};
