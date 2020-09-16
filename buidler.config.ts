import { usePlugin, BuidlerConfig } from '@nomiclabs/buidler/config';

usePlugin('@nomiclabs/buidler-waffle');

const config: BuidlerConfig = {
  networks: {
    buidlerevm: {
      // The BPool contract is too large to be deployed normally when compiled with no optimizations
      blockGasLimit: 12e6,
      allowUnlimitedContractSize: true,
    },
  },
  solc: {
    version: '0.5.12',
  },
};

export default config;
