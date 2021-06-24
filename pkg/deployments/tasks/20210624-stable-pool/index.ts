import Task from '../../src/task';

import { StablePoolDeployment } from './input';

export default async (task: Task, force = false): Promise<void> => {
  const output = task.output({ ensure: false });

  if (force || !output.factory) {
    const input = task.input() as StablePoolDeployment;
    const factory = await task.deploy('StablePoolFactory', [input.vault]);
    task.save({ factory });
  }
};
