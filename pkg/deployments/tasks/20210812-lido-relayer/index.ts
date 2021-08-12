import Task from '../../src/task';
import logger from '../../src/logger';
import { TaskRunOptions } from '../../src/types';
import { LidoRelayerDeployment } from './input';

const wstETHMap: Record<string, string> = {
  mainnet: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
  goerli: '0x6320cd32aa674d2898a68ec82e869385fc5f7e2f',
  kovan: '0xA387B91e393cFB9356A460370842BC8dBB2F29aF',
};

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const output = task.output({ ensure: false });
  const input = task.input() as LidoRelayerDeployment;
  const args = [input.vault, wstETHMap[task.network]];

  if (force || !output.relayer) {
    const relayer = await task.deploy('LidoRelayer', args, from);
    task.save({ relayer });
    await task.verify('LidoRelayer', relayer.address, args);
  } else {
    logger.info(`LidoRelayer already deployed at ${output.relayer}`);
    await task.verify('LidoRelayer', output.relayer, args);
  }
};
