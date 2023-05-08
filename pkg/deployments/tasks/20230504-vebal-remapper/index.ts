import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { VotingEscrowRemapperDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as VotingEscrowRemapperDeployment;

  const adaptorArgs = [input.Vault];
  const omniVotingEscrowAdaptor = await task.deployAndVerify('OmniVotingEscrowAdaptor', adaptorArgs, from, force);

  const remapperArgs = [input.Vault, input.VotingEscrow, omniVotingEscrowAdaptor.address];
  await task.deployAndVerify('VotingEscrowRemapper', remapperArgs, from, force);
};
