import { RunSuperFunction, HardhatRuntimeEnvironment, HttpNetworkConfig, HardhatNetworkConfig } from 'hardhat/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

export default async function (args: any, hre: HardhatRuntimeEnvironment, run: RunSuperFunction<any>): Promise<void> {
  console.log('Running fork tests...');
  const idFilter = (file: string, id: string | undefined) => {
    if (id !== undefined) {
      return file.includes(id);
    }
    return true;
  };
  args.testFiles = args.testFiles.filter((file: string) => file.endsWith('.fork.ts') && idFilter(file, args.id));
  await run(args);
}

export function getForkedNetwork(hre: HardhatRuntimeEnvironment): string {
  const config = hre.network.config as HardhatNetworkConfig;
  if (!config.forking || !config.forking.url) throw Error(`No forks found on network ${hre.network.name}`);

  const network = Object.entries(hre.config.networks).find(([, networkConfig]) => {
    const httpNetworkConfig = networkConfig as HttpNetworkConfig;
    return httpNetworkConfig.url && httpNetworkConfig.url === config?.forking?.url;
  });

  if (!network) throw Error(`No network found matching fork from ${config.forking.url}`);
  return network[0];
}
