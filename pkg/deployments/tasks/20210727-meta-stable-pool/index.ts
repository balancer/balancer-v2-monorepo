import Task from '../../src/task';
import logger from '../../src/logger';
import { TaskRunOptions } from '../../src/types';
import { MetaStablePoolDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  let QueryProcessor: string;
  const output = task.output({ ensure: false });

  if (force || !output.QueryProcessor) {
    QueryProcessor = (await task.deploy('QueryProcessor')).address;
    task.save({ QueryProcessor });
  } else {
    QueryProcessor = output.QueryProcessor;
    logger.info(`QueryProcessor already deployed at ${output.QueryProcessor}`);
  }

  const input = task.input() as MetaStablePoolDeployment;
  const args = [input.Vault];
  await task.deployAndVerify('MetaStablePoolFactory', args, from, force, { QueryProcessor });
};
