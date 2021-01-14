import 'dotenv/config';
import { HardhatUserConfig } from 'hardhat/config';
import { NetworkUserConfig } from 'hardhat/types';
import '@tenderly/hardhat-tenderly';
import 'hardhat-deploy';
import 'hardhat-abi-exporter';
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-waffle';
import 'solidity-coverage';

import './scripts/seeding/seedPools';

const chainIds = {
  ganache: 1337,
  goerli: 5,
  hardhat: 31337,
  kovan: 42,
  mainnet: 1,
  rinkeby: 4,
  ropsten: 3,
  dockerParity: 17
};

// Ensure that we have all the environment variables we need.
let mnemonic: string;
if (!process.env.MNEMONIC) {
  mnemonic = 'test test test test test test test test test test test junk';
} else {
  mnemonic = process.env.MNEMONIC;
}

let infuraApiKey: string;
if (!process.env.INFURA_API_KEY) {
  throw new Error('Please set your INFURA_API_KEY in a .env file');
} else {
  infuraApiKey = process.env.INFURA_API_KEY;
}

function createTestnetConfig(network: keyof typeof chainIds): NetworkUserConfig {
  const url: string = 'https://' + network + '.infura.io/v3/' + infuraApiKey;
  return {
    accounts: {
      count: 10,
      initialIndex: 0,
      mnemonic,
      path: "m/44'/60'/0'/0",
    },
    chainId: chainIds[network],
    url,
  };
}

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      chainId: chainIds.hardhat,
      saveDeployments: true,
    },
    dockerParity: {
      gas: 10000000,
      live: false,
      chainId: chainIds.dockerParity,
      url: 'http://localhost:8545',
      allowUnlimitedContractSize: true,
      saveDeployments: true,
    },
    localhost: {
      allowUnlimitedContractSize: true,
      saveDeployments: true,
    },
    goerli: createTestnetConfig('goerli'),
    kovan: createTestnetConfig('kovan'),
    rinkeby: createTestnetConfig('rinkeby'),
    ropsten: createTestnetConfig('ropsten'),
  },
  namedAccounts: {
    deployer: {
      default: 0,
      1: 0, // mainnet
      4: 0, // rinkeby
      17: 0, // dockerParity
    },
    admin: {
      default: 1, // here this will by default take the first account as deployer
      // We use explicit chain IDs so that export-all works correctly: https://github.com/wighawag/hardhat-deploy#options-2
      1: 1, // mainnet
      4: 1, // rinkeby
      17: 1, // dockerParity
    },
  },
  solidity: {
    version: '0.7.1',
    settings: {
      optimizer: {
        enabled: true,
        runs: 0,
      },
    },
  },
  abiExporter: {
    only: ['Vault', 'WeightedPool', 'StablePool', 'FixedSetPoolTokenizer', 'BalancerPoolToken', 'BasePoolFactory', 'ERC20'],
    flat: true,
  },
  tenderly: {
    username: 'balancer',
    project: 'v2',
  },
};

export default config;
