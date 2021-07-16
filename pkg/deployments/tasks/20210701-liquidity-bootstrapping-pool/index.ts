import Task from '../../src/task';
import logger from '../../src/logger';
import { TaskRunOptions } from '../../src/types';
import { LiquidityBootstrappingPoolDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const output = task.output({ ensure: false });
  const input = task.input() as LiquidityBootstrappingPoolDeployment;
  const args = [input.vault];

  if (force || !output.factory) {
    const factory = await task.deploy('LiquidityBootstrappingPoolFactory', args, from);
    task.save({ factory });
    await task.verify('LiquidityBootstrappingPoolFactory', factory.address, args);
  } else {
    logger.info(`LiquidityBootstrappingPoolFactory already deployed at ${output.factory}`);
    await task.verify('LiquidityBootstrappingPoolFactory', output.factory, args);
  }
};
