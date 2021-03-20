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

const INFURA_KEY = process.env.INFURA_KEY || '';
const DEPLOYER_PRIVATE_KEY =
  process.env.DEPLOYER_PRIVATE_KEY || '0000000000000000000000000000000000000000000000000000000000000000';

const CONTROLLER_PRIVATE_KEY =
  process.env.CONTROLLER_PRIVATE_KEY || '0000000000000000000000000000000000000000000000000000000000000000';

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
    mainnet: {
      chainId: CHAIN_IDS.mainnet,
      url: `https://mainnet.infura.io/v3/${INFURA_KEY}`,
      accounts: [`0x${DEPLOYER_PRIVATE_KEY}`,`0x${CONTROLLER_PRIVATE_KEY}`], // Using private key instead of mnemonic for vanity deploy
      saveDeployments: true,
    },
    ropsten: {
      chainId: CHAIN_IDS.ropsten,
      url: `https://ropsten.infura.io/v3/${INFURA_KEY}`,
      accounts: [`0x${DEPLOYER_PRIVATE_KEY}`,`0x${CONTROLLER_PRIVATE_KEY}`], // Using private key instead of mnemonic for vanity deploy
      saveDeployments: true,
    },
    kovan: {
      chainId: CHAIN_IDS.kovan,
      url: `https://kovan.infura.io/v3/${INFURA_KEY}`,
      accounts: [`0x${DEPLOYER_PRIVATE_KEY}`,`0x${CONTROLLER_PRIVATE_KEY}`], // Using private key instead of mnemonic for vanity deploy
      saveDeployments: true,
    },
    rinkeby: {
      chainId: CHAIN_IDS.rinkeby,
      url: `https://rinkeby.infura.io/v3/${INFURA_KEY}`,
      accounts: [`0x${DEPLOYER_PRIVATE_KEY}`,`0x${CONTROLLER_PRIVATE_KEY}`], // Using private key instead of mnemonic for vanity deploy
      saveDeployments: true,
    },
    goerli: {
      chainId: CHAIN_IDS.goerli,
      url: `https://goerli.infura.io/v3/${INFURA_KEY}`,
      accounts: [`0x${DEPLOYER_PRIVATE_KEY}`,`0x${CONTROLLER_PRIVATE_KEY}`], // Using private key instead of mnemonic for vanity deploy
      saveDeployments: true,
    },
  },
  namedAccounts: {
    deployer: {
      default: 0,
      [CHAIN_IDS.mainnet]: 0,
      [CHAIN_IDS.kovan]: 0,
      [CHAIN_IDS.ropsten]: 0,
      [CHAIN_IDS.goerli]: 0,
      [CHAIN_IDS.rinkeby]: 0,
      [CHAIN_IDS.dockerParity]: 0,
    },
    admin: {
      default: 1, // here this will by default take the first account as deployer
      // We use explicit chain IDs so that export-all works correctly: https://github.com/wighawag/hardhat-deploy#options-2
      [CHAIN_IDS.mainnet]: 1,
      [CHAIN_IDS.kovan]: 1,
      [CHAIN_IDS.ropsten]: 1,
      [CHAIN_IDS.goerli]: 1,
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
          debug: {
            revertStrings: 'strip',
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
          debug: {
            revertStrings: 'strip',
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
