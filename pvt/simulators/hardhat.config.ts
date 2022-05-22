import '@nomiclabs/hardhat-ethers';

import { hardhatBaseConfig } from '@balancer-labs/v2-common';
import { name } from './package.json';

export default {
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
    },
  },
  solidity: {
    compilers: hardhatBaseConfig.compilers,
    overrides: { ...hardhatBaseConfig.overrides(name) },
  },
};
