import Task from '../../src/task';

export type GaugeSystemDeployment = {
  BAL: string;
  BPT: string;
  BalancerTokenAdmin: string;
};

const BalancerTokenAdmin = new Task('2022xxxx-balancer-token-admin');

// Vote locking systems is only to be deployed to mainnet and kovan
// BPT is the 80-20 BAL-WETH BPT token address
export default {
  mainnet: {
    BalancerTokenAdmin,
    BAL: '0xba100000625a3754423978a60c9317c58a424e3D',
    BPT: '0x5c6Ee304399DBdB9C8Ef030aB642B10820DB8F56',
  },
  kovan: {
    BalancerTokenAdmin,
    BAL: '0x41286Bb1D3E870f3F750eB7E1C25d7E48c8A1Ac7',
    BPT: '0x61d5dc44849c9C87b0856a2a311536205C96c7FD',
  },
};
