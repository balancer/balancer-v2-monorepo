import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  await task.deployAndVerify('DistributionScheduler', [], from, force);
};
