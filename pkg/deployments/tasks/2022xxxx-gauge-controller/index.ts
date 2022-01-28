import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { GaugeSystemDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as GaugeSystemDeployment;

  const veBPTArgs = [input.BPT, 'Vote Escrowed Balancer BPT', 'vebptBAL', '1'];
  const veBPT = await task.deployAndVerify('VotingEscrow', veBPTArgs, from, force);

  const gaugeControllerArgs = [input.BAL, veBPT.address];
  const gaugeController = await task.deployAndVerify('GaugeController', gaugeControllerArgs, from, force);

  const minterArgs = [input.BalancerTokenAdmin, gaugeController.address];
  await task.deployAndVerify('BalancerMinter', minterArgs, from, force);
};
