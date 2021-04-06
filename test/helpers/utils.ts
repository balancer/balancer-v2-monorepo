import { network } from 'hardhat';
import { EthereumProvider } from 'hardhat/types';

export async function takeSnapshot(provider: EthereumProvider): Promise<string> {
  return (await provider.request({
    method: 'evm_snapshot',
  })) as string;
}

export async function revert(provider: EthereumProvider, snapshotId: string): Promise<void> {
  await provider.request({
    method: 'evm_revert',
    params: [snapshotId],
  });
}

export async function getProvider(): Promise<EthereumProvider> {
  const hre = await import('hardhat');
  return hre.network.provider;
}

export const lastBlockNumber = async (): Promise<number> => Number(await network.provider.send('eth_blockNumber'));
