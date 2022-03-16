import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { TestBalancerTokenDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as TestBalancerTokenDeployment;

  const args = [input.VotingEscrow, 'VotingEscrow Delegation', 'veBoost', ''];
  const votingEscrowDelegation = await task.deploy('VotingEscrowDelegation', args, from);

  const proxyArgs = [input.Vault, input.VotingEscrow, votingEscrowDelegation.address];
  await task.deployAndVerify('VotingEscrowDelegationProxy', proxyArgs, from, force);
};
