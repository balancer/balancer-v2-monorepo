import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { VotingEscrowRemapperDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as VotingEscrowRemapperDeployment;

  const args = [input.VotingEscrow, input.Vault];
  await task.deployAndVerify('VotingEscrowRemapper', args, from, force);
};
