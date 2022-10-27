import Task, { TaskMode } from '../../src/task';

export type BatchRelayerDeployment = {
  Vault: string;
  wstETH: string;
  BalancerMinter: string;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const BalancerMinter = new Task('20220325-gauge-controller', TaskMode.READ_ONLY);

export default {
  Vault,
  // wstETH and BalancerMinter are only deployed on mainnet, and goerli.
  mainnet: {
    wstETH: '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0',
    BalancerMinter,
  },
  goerli: {
    wstETH: '0x6320cD32aA674d2898A68ec82e869385Fc5f7E2f',
    BalancerMinter,
  },
  polygon: {
    wstETH: '0x0000000000000000000000000000000000000000',
    BalancerMinter: '0x0000000000000000000000000000000000000000',
  },
  arbitrum: {
    wstETH: '0x0000000000000000000000000000000000000000',
    BalancerMinter: '0x0000000000000000000000000000000000000000',
  },
  optimism: {
    wstETH: '0x0000000000000000000000000000000000000000',
    BalancerMinter: '0x0000000000000000000000000000000000000000',
  },
};
