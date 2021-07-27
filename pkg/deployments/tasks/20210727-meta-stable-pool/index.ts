import Task from '../../src/task';
import logger from '../../src/logger';
import { TaskRunOptions } from '../../src/types';
import { MetaStablePoolDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const output = task.output({ ensure: false });
  const input = task.input() as MetaStablePoolDeployment;
  const args = [input.vault];

  if (force || !output.factory) {
    const query = await task.deploy('QueryProcessor');
    task.save({ query });
    const factory = await task.deploy('MetaStablePoolFactory', args, from, { QueryProcessor: query.address });
    task.save({ factory });
    await task.verify('MetaStablePoolFactory', factory.address, args);
  } else {
    logger.info(`MetaStablePoolFactory already deployed at ${output.factory}`);
    await task.verify('MetaStablePoolFactory', output.factory, args);
  }
};
