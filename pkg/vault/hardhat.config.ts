// import '@nomiclabs/hardhat-ethers';
// import '@nomiclabs/hardhat-waffle';
// // import 'hardhat-ignore-warnings';
// import '@matterlabs/hardhat-zksync-solc';
// import '@matterlabs/hardhat-zksync-deploy';
// import '@matterlabs/hardhat-zksync-verify';

// // import { hardhatBaseConfig } from '@balancer-labs/v2-common';
// // import { name } from './package.json';

// // import { task } from 'hardhat/config';
// // import { TASK_COMPILE } from 'hardhat/builtin-tasks/task-names';
// // import overrideQueryFunctions from '@balancer-labs/v2-helpers/plugins/overrideQueryFunctions';

// // task(TASK_COMPILE).setAction(overrideQueryFunctions);

// export default {
//   solidity: {
//     version: '0.7.1',
//     settings: {
//       optimizer: {
//         enabled: true,
//         runs: 9999,
//       },
//     },
//   },
//   networks: {
//     zkTestnet: {
//       zksync: true,
//       ethNetwork: 'goerli',
//       url: 'https://zksync2-testnet.zksync.dev',
//       verifyURL: 'https://zksync2-testnet-explorer.zksync.dev/contract_verification',
//     },
//   },
//   zksolc: {
//     version: '1.3.7',
//     compilerSource: 'binary',
//   },
// };

import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-waffle';
import '@matterlabs/hardhat-zksync-solc';

export default {
  solidity: {
    version: '0.7.1',
    settings: {
      optimizer: {
        enabled: true,
        runs: 9999,
      },
    },
  },
  networks: {
    zkTestnet: {
      zksync: true,
      ethNetwork: 'goerli',
      url: 'https://zksync2-testnet.zksync.dev',
      verifyURL: 'https://zksync2-testnet-explorer.zksync.dev/contract_verification',
    },
  },
  zksolc: {
    version: '1.3.7',
    compilerSource: 'binary',
  },
};
