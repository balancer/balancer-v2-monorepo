import 'dotenv/config';
import 'solidity-coverage';
import '@tenderly/hardhat-tenderly';
import 'hardhat-deploy';
import 'hardhat-abi-exporter';
import 'hardhat-local-networks-config-plugin';
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-waffle';
import { task } from 'hardhat/config';

task('seed', 'Add seed data').setAction(async (args, hre) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const action = require('./lib/scripts/seeding/seedPools');
  await action(args, hre);
});

const CHAIN_IDS = {
  hardhat: 31337,
  kovan: 42,
  goerli: 5,
  mainnet: 1,
  rinkeby: 4,
  ropsten: 3,
  dockerParity: 17,
};

export default {
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      chainId: CHAIN_IDS.hardhat,
      saveDeployments: true,
    },
    dockerParity: {
      gas: 10000000,
      live: false,
      chainId: CHAIN_IDS.dockerParity,
      url: 'http://localhost:8545',
      allowUnlimitedContractSize: true,
      saveDeployments: true,
    },
    localhost: {
      allowUnlimitedContractSize: true,
      saveDeployments: true,
    },
  },
  namedAccounts: {
    deployer: {
      default: 0,
      [CHAIN_IDS.mainnet]: 0,
      [CHAIN_IDS.rinkeby]: 0,
      [CHAIN_IDS.dockerParity]: 0,
    },
    admin: {
      default: 1, // here this will by default take the first account as deployer
      // We use explicit chain IDs so that export-all works correctly: https://github.com/wighawag/hardhat-deploy#options-2
      [CHAIN_IDS.mainnet]: 1,
      [CHAIN_IDS.rinkeby]: 1,
      [CHAIN_IDS.dockerParity]: 1,
    },
  },
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
        version: '0.7.0',
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
  tenderly: {
    username: 'balancer',
    project: 'v2',
  },
  paths: {
    deploy: 'deployments/migrations',
    deployments: 'deployments/artifacts',
  },
};
