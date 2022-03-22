import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { GaugeSystemDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as GaugeSystemDeployment;

  const gaugeImplementationArgs = [input.BalancerMinter, input.VotingEscrowDelegationProxy, input.AuthorizerAdaptor];
  const gaugeImplementation = await task.deployAndVerify('LiquidityGaugeV5', gaugeImplementationArgs, from, force);

  const args = [input.Vault, gaugeImplementation.address];
  await task.deployAndVerify('LiquidityGaugeFactory', args, from, force);
};
