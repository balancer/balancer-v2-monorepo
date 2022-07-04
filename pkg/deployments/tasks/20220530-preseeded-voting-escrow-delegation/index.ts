import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { PreseededVotingEscrowDelegationDeployment } from './input';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as PreseededVotingEscrowDelegationDeployment;

  const args = [
    input.VotingEscrow,
    'VotingEscrow Delegation',
    'veBoost',
    '',
    input.AuthorizerAdaptor,
    input.PreseededBoostCalls.concat(
      new Array<typeof input.PreseededBoostCalls[number]>(10 - input.PreseededBoostCalls.length).fill({
        delegator: ZERO_ADDRESS,
        receiver: ZERO_ADDRESS,
        percentage: 0,
        cancel_time: 0,
        expire_time: 0,
        id: 0,
      })
    ),
    input.PreseededApprovalCalls.concat(
      new Array<typeof input.PreseededApprovalCalls[number]>(10 - input.PreseededApprovalCalls.length).fill({
        operator: ZERO_ADDRESS,
        delegator: ZERO_ADDRESS,
      })
    ),
  ];

  await task.deploy('PreseededVotingEscrowDelegation', args, from, force);
};
