import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { GaugeAdderDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as GaugeAdderDeployment;

  const gaugeAdderArgs = [input.GaugeController, input.PreviousGaugeAdder];
  await task.deployAndVerify('GaugeAdder', gaugeAdderArgs, from, force);
};
