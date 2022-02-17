import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { GaugeSystemDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as GaugeSystemDeployment;

  const veBALArgs = [input.BPT, 'Vote Escrowed Balancer BPT', 'veBAL'];
  const veBAL = await task.deployAndVerify('VotingEscrow', veBALArgs, from, force);

  const gaugeControllerArgs = [veBAL.address];
  const gaugeController = await task.deployAndVerify('GaugeController', gaugeControllerArgs, from, force);

  const minterArgs = [input.BalancerTokenAdmin, gaugeController.address];
  await task.deployAndVerify('BalancerMinter', minterArgs, from, force);
};
