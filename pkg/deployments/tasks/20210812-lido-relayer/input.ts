import Task from '../../src/task';

export type LidoRelayerDeployment = {
  vault: string;
  wstETH: string;
};

const vault = new Task('20210418-vault');

export default {
  mainnet: {
    vault,
    wstETH: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
  },
  goerli: {
    vault,
    wstETH: '0x6320cd32aa674d2898a68ec82e869385fc5f7e2f',
  },
  kovan: {
    vault,
    wstETH: '0xA387B91e393cFB9356A460370842BC8dBB2F29aF',
  },
};
