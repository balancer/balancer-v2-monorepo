import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { wBETHRateProviderDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as wBETHRateProviderDeployment;

  const rateProviderArgs = [input.wBETH];
  await task.deployAndVerify('BinanceBeaconEthRateProvider', rateProviderArgs, from, force);
};
