import Task from '../../src/task';

import logger from '../../src/logger';
import { WeightedPoolDeployment } from './input';

export default async (task: Task, force = false): Promise<void> => {
  const output = task.output({ ensure: false });
  const input = task.input() as WeightedPoolDeployment;
  const args = [input.vault];

  if (force || !output.factory) {
    const factory = await task.deploy('WeightedPoolFactory', args);
    task.save({ factory });
    await task.verify('WeightedPoolFactory', factory.address, args);
  } else {
    logger.info(`WeightedPoolFactory already deployed at ${output.factory}`);
    await task.verify('WeightedPoolFactory', output.factory, args);
  }
};
