import '@matterlabs/hardhat-zksync';
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-waffle';
import 'hardhat-ignore-warnings';

import { hardhatBaseConfig } from '@balancer-labs/v2-common';
import { name } from './package.json';

import { task } from 'hardhat/config';
import { TASK_COMPILE } from 'hardhat/builtin-tasks/task-names';
import overrideQueryFunctions from '@balancer-labs/v2-helpers/plugins/overrideQueryFunctions';

task(TASK_COMPILE).setAction(overrideQueryFunctions);

export default {
  solidity: {
    compilers: hardhatBaseConfig.compilers,
    overrides: { ...hardhatBaseConfig.overrides(name) },
  },
  warnings: hardhatBaseConfig.warnings,
  zksolc: {
    version: '1.5.12',
    compilerSource: 'binary',
    settings: {
      optimizer: {
        enabled: true,
        mode: '3',
      },
    },
  },
  networks: {
    lensTestnet: {
      chainId: 37111,
      ethNetwork: 'sepolia',
      url: 'https://rpc.testnet.lens.xyz',
      verifyURL: 'https://block-explorer-verify.testnet.lens.xyz/contract_verification',
      zksync: true,
    },
    lensMainnet: {
      chainId: 232,
      ethNetwork: 'sepolia',
      url: 'https://rpc.lens.xyz',
      verifyURL: 'https://verify.lens.xyz/contract_verification',
      zksync: true,
    },
    hardhat: {
      zksync: true,
    },
  },
};
