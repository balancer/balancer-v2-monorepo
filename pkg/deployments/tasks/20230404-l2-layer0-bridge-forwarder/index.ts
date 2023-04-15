import Task from '../../src/task';
import { L2Layer0BridgeForwarderDeployment } from './input';
import { TaskRunOptions } from '../../src/types';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as L2Layer0BridgeForwarderDeployment;
  await task.deployAndVerify('L2LayerZeroBridgeForwarder', [input.Vault], from, force);
};
