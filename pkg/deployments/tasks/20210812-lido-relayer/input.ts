import Task from '../../src/task';

export type LidoRelayerDeployment = {
  Vault: string;
  wstETH: string;
};

const Vault = new Task('20210418-vault');

export default {
  mainnet: {
    Vault,
    wstETH: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
  },
  kovan: {
    Vault,
    wstETH: '0xA387B91e393cFB9356A460370842BC8dBB2F29aF',
  },
};
