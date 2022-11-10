import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { GaugeAdderDeployment } from './input';

export default async (task: Task, { force, from, extra }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as GaugeAdderDeployment;

  // TODO: replace extra with real entrypoint
  const AuthorizerAdaptorEntrypoint = extra as string;

  const gaugeAdderArgs = [input.GaugeController, input.PreviousGaugeAdder, AuthorizerAdaptorEntrypoint];
  await task.deployAndVerify('GaugeAdder', gaugeAdderArgs, from, force);
};
