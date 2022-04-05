import Task from '../../src/task';

export type BatchRelayerDeployment = {
  Vault: string;
  wstETH: string;
};

const Vault = new Task('20210418-vault');

export default {
  Vault,
  // wstETH is not deployed on polygon
  polygon: {
    wstETH: '0x0000000000000000000000000000000000000000',
  },
};
