import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { GaugeSystemDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as GaugeSystemDeployment;

  // veBoost proxy deployment does not exist so use zero address for now
  // TODO: add deployment task for this
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  const gaugeImplementationArgs = [input.BalancerMinter, ZERO_ADDRESS];
  const gaugeImplementation = await task.deployAndVerify('LiquidityGaugeV5', gaugeImplementationArgs, from, force);

  const args = [input.Vault, gaugeImplementation.address, input.AuthorizerAdaptor];
  await task.deployAndVerify('LiquidityGaugeFactory', args, from, force);
};
