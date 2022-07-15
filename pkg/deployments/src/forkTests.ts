import hre from 'hardhat';

import { HttpNetworkConfig, HardhatNetworkConfig } from 'hardhat/types';

export function describeForkTest(
  name: string,
  blockNumber: number,
  callback: () => void,
  forkNetwork = 'mainnet'
): void {
  describe(name, () => {
    before('setup fork test', async () => {
      const forkingNetworkName = Object.keys(hre.config.networks).find((networkName) => networkName === forkNetwork);
      if (!forkingNetworkName) throw Error(`Could not find a config for network ${forkNetwork} to be forked`);

      const forkingNetworkConfig = hre.config.networks[forkingNetworkName] as HttpNetworkConfig;
      if (!forkingNetworkConfig.url)
        throw Error(`Could not find a RPC url in network config for ${forkingNetworkName}`);

      await hre.network.provider.request({
        method: 'hardhat_reset',
        params: [{ forking: { jsonRpcUrl: forkingNetworkConfig.url, blockNumber: blockNumber } }],
      });

      const config = hre.network.config as HardhatNetworkConfig;
      config.forking = { enabled: true, blockNumber: blockNumber, url: forkingNetworkConfig.url };
    });
    callback();
  });
}
