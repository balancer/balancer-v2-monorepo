import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { FeeSplitterDeployement } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as FeeSplitterDeployement;
  const args = [input.protocolFeesWithdrawer, input.treasury];
  await task.deployAndVerify('ProtocolFeeSplitter', args, from, force);
};
