import Task from '../../src/task';
import logger from '../../src/logger';
import { TaskRunOptions } from '../../src/types';
import { NoProtocolFeeLiquidityBootstrappingPoolDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const output = task.output({ ensure: false });
  const input = task.input() as NoProtocolFeeLiquidityBootstrappingPoolDeployment;
  const args = [input.Vault];

  if (force || !output.factory) {
    const factory = await task.deploy('NoProtocolFeeLiquidityBootstrappingPoolFactory', args, from);
    task.save({ factory });
    await task.verify('NoProtocolFeeLiquidityBootstrappingPoolFactory', factory.address, args);
  } else {
    logger.info(`NoProtocolFeeLiquidityBootstrappingPoolFactory already deployed at ${output.factory}`);
    await task.verify('NoProtocolFeeLiquidityBootstrappingPoolFactory', output.factory, args);
  }
};
