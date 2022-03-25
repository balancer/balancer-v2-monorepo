import Task from '../../src/task';

export type GaugeSystemDeployment = {
  BPT: string;
  BalancerTokenAdmin: string;
  AuthorizerAdaptor: string;
};

const AuthorizerAdaptor = new Task('20220325-authorizer-adaptor');
const BalancerTokenAdmin = new Task('20220325-balancer-token-admin');

export default {
  AuthorizerAdaptor,
  BalancerTokenAdmin,
  mainnet: {
    BPT: '0x5c6Ee304399DBdB9C8Ef030aB642B10820DB8F56', // BPT of the canonical 80-20 BAL-WETH Pool
  },
  kovan: {
    BPT: '0xDC2EcFDf2688f92c85064bE0b929693ACC6dBcA6', // BPT of an 80-20 BAL-WETH Pool using test BAL
  },
};
