import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { L2GaugeCheckpointerDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as L2GaugeCheckpointerDeployment;

  const args = [input.GaugeController, input.AuthorizerAdaptorEntrypoint];
  await task.deployAndVerify('L2GaugeCheckpointer', args, from, force);
};
