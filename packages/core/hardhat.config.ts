import 'solidity-coverage';
import 'hardhat-abi-exporter';
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-waffle';

import { task } from 'hardhat/config';
import { TASK_COMPILE } from 'hardhat/builtin-tasks/task-names';
import overrideQueryFunctions from './scripts/plugins/overrideQueryFunctions';

task(TASK_COMPILE).setAction(overrideQueryFunctions);

export default {
  solidity: {
    compilers: [
      {
        version: '0.7.1',
        settings: {
          optimizer: {
            enabled: true,
            runs: 9999,
          },
        },
      },
    ],
    overrides: {
      'contracts/vault/Vault.sol': {
        version: '0.7.1',
        settings: {
          optimizer: {
            enabled: true,
            runs: 400,
          },
        },
      },
    },
  },
  abiExporter: {
    only: [
      'Vault',
      'WeightedPool',
      'StablePool',
      'WeightedPoolFactory',
      'StablePoolFactory',
      'BalancerPoolToken',
      'BasePoolFactory',
      'ERC20',
      'BalancerHelpers',
    ],
    flat: true,
  },
};
