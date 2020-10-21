import { usePlugin, BuidlerConfig } from '@nomiclabs/buidler/config';

usePlugin('@nomiclabs/buidler-waffle');

const config: BuidlerConfig = {
  networks: {
    buidlerevm: {
      allowUnlimitedContractSize: true,
    },
  },
  solc: {
    version: '0.7.1',
    optimizer: {
      enabled: true,
      runs: 9999,
    },
  },
};

export default config;
