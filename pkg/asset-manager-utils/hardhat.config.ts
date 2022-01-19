import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-waffle';

import { hardhatBaseConfig } from '@balancer-labs/v2-common';
import { name } from './package.json';

export default {
  networks: hardhatBaseConfig.networks,
  solidity: {
    compilers: hardhatBaseConfig.compilers,
    overrides: { ...hardhatBaseConfig.overrides(name) },
  },
};
