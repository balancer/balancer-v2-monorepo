import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { AaveLinearPoolDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as AaveLinearPoolDeployment;
  const args = [
    input.Vault,
    input.ProtocolFeePercentagesProvider,
    input.BalancerQueries,
    input.FactoryVersion,
    input.PoolVersion,
  ];

  await task.deployAndVerify('AaveLinearPoolFactory', args, from, force);
};
