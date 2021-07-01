import Task from '../../src/task';
import logger from '../../src/logger';
import { TaskRunOptions } from '../../src/types';
import { StablePoolDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const output = task.output({ ensure: false });
  const input = task.input() as StablePoolDeployment;
  const args = [input.vault];

  if (force || !output.factory) {
    const factory = await task.deploy('StablePoolFactory', args, from);
    task.save({ factory });
    await task.verify('StablePoolFactory', factory.address, args);
  } else {
    logger.info(`StablePoolFactory already deployed at ${output.factory}`);
    await task.verify('StablePoolFactory', output.factory, args);
  }
};
