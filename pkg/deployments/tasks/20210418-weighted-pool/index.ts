import Task from '../../src/task';
import logger from '../../src/logger';
import { TaskRunOptions } from '../../src/types';
import { WeightedPoolDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const output = task.output({ ensure: false });
  const input = task.input() as WeightedPoolDeployment;
  const args = [input.vault];

  if (force || !output.nTokensFactory) {
    const factory = await task.deploy('WeightedPoolFactory', args, from);
    task.save({ nTokensFactory: factory });
    await task.verify('WeightedPoolFactory', factory.address, args);
  } else {
    logger.info(`WeightedPoolFactory already deployed at ${output.nTokensFactory}`);
    await task.verify('WeightedPoolFactory', output.nTokensFactory, args);
  }

  if (force || !output['2TokensFactory']) {
    const factory = await task.deploy('WeightedPool2TokensFactory', args, from);
    task.save({ '2TokensFactory': factory });
    await task.verify('WeightedPool2TokensFactory', factory.address, args);
  } else {
    logger.info(`WeightedPool2TokensFactory already deployed at ${output['2TokensFactory']}`);
    await task.verify('WeightedPool2TokensFactory', output['2TokensFactory'], args);
  }
};
