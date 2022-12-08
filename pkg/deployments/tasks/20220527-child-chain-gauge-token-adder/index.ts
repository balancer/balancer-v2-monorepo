import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { ChildChainGaugeTokenAdderDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as ChildChainGaugeTokenAdderDeployment;

  const args = [input.ChildChainLiquidityGaugeFactory, input.AuthorizerAdaptor];
  await task.deployAndVerify('ChildChainGaugeTokenAdder', args, from, force);
};
