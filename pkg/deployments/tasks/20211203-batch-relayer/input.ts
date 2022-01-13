import Task from '../../src/task';

export type BatchRelayerDeployment = {
  Vault: string;
  wstETH: string;
};

const Vault = new Task('20210418-vault');

export default {
  // wstETH is only deployed on mainnet and kovan
  mainnet: {
    Vault,
    wstETH: '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0',
  },
  kovan: {
    Vault,
    wstETH: '0xa387b91e393cfb9356a460370842bc8dbb2f29af',
  },
  rinkeby: {
    Vault,
    wstETH: '0x0000000000000000000000000000000000000000',
  },
  polygon: {
    Vault,
    wstETH: '0x0000000000000000000000000000000000000000',
  },
  arbitrum: {
    Vault,
    wstETH: '0x0000000000000000000000000000000000000000',
  },
};
