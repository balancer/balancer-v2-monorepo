import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { ProtocolIdRegistryDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as ProtocolIdRegistryDeployment;

  const args = [input.Vault];
  await task.deployAndVerify('ProtocolIdRegistry', args, from, force);
};
