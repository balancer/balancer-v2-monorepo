import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { ArbitrumRootGaugeFactoryDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as ArbitrumRootGaugeFactoryDeployment;

  const args = [
    input.Vault,
    input.BalancerMinter,
    input.GatewayRouter,
    input.GasLimit,
    input.GasPrice,
    input.MaxSubmissionCost,
  ];

  const factory = await task.deployAndVerify('ArbitrumRootGaugeFactory', args, from, force);

  await task.verify('ArbitrumRootGauge', await factory.getGaugeImplementation(), [
    input.BalancerMinter,
    input.GatewayRouter,
  ]);
};
