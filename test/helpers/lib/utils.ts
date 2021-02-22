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

export async function getProvider(provider?: EthereumProvider): Promise<EthereumProvider> {
  if (provider !== undefined) {
    return provider;
  }

  const hre = await import('hardhat');
  return hre.network.provider;
}

export function wrapWithTitle(title: string | undefined, str: string): string {
  if (title === undefined) {
    return str;
  }

  return `${title} at step "${str}"`;
}
