import Task from '../../src/task';

export type GaugeSystemDeployment = {
  BPT: string;
  BalancerTokenAdmin: string;
  AuthorizerAdaptor: string;
};

const AuthorizerAdaptor = new Task('2022xxxx-authorizer-adaptor');
const BalancerTokenAdmin = new Task('2022xxxx-balancer-token-admin');

// Vote locking systems is only to be deployed to mainnet and kovan
// BPT is the 80-20 BAL-WETH BPT token address
export default {
  mainnet: {
    AuthorizerAdaptor,
    BalancerTokenAdmin,
    BPT: '0x5c6Ee304399DBdB9C8Ef030aB642B10820DB8F56', // BPT of the canonical 80-20 BAL-WETH Pool
  },
  kovan: {
    AuthorizerAdaptor,
    BalancerTokenAdmin,
    BPT: '0xDC2EcFDf2688f92c85064bE0b929693ACC6dBcA6', // BPT of an 80-20 BAL-WETH Pool using test BAL
  },
};
