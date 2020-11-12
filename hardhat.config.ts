import { HardhatUserConfig } from 'hardhat/config';
import 'hardhat-deploy';
import '@nomiclabs/hardhat-waffle';

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      saveDeployments: false,
    },
    localhost: {
      allowUnlimitedContractSize: true,
      saveDeployments: false,
    },
  },
  namedAccounts: {
    deployer: {
      default: 0, // here this will by default take the first account as deployer
      1: 0,
      4: '', // rinkeby
    }
  },
  solidity: {
    version: '0.7.1',
    settings: {
      optimizer: {
        enabled: true,
        runs: 9999,
      },
    },
  },
};

export default config;
