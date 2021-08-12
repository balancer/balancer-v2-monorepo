import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { LidoRelayerDeployment } from './input';

const wstETHMap: Record<string, string> = {
  mainnet: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
  goerli: '0x6320cd32aa674d2898a68ec82e869385fc5f7e2f',
  kovan: '0xA387B91e393cFB9356A460370842BC8dBB2F29aF',
};

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as LidoRelayerDeployment;

  const rateProviderArgs = [wstETHMap[task.network]];
  task.deployAndVerify('WstETHRateProvider', rateProviderArgs, from, force);

  const relayerArgs = [input.vault, wstETHMap[task.network]];
  task.deployAndVerify('LidoRelayer', relayerArgs, from, force);
};
