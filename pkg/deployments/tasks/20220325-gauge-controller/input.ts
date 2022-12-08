import Task, { TaskMode } from '../../src/task';

export type GaugeSystemDeployment = {
  BPT: string;
  BalancerTokenAdmin: string;
  AuthorizerAdaptor: string;
};

const AuthorizerAdaptor = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY);
const BalancerTokenAdmin = new Task('20220325-balancer-token-admin', TaskMode.READ_ONLY);

export default {
  AuthorizerAdaptor,
  BalancerTokenAdmin,
  mainnet: {
    BPT: '0x5c6Ee304399DBdB9C8Ef030aB642B10820DB8F56', // BPT of the canonical 80-20 BAL-WETH Pool
  },
  kovan: {
    BPT: '0xDC2EcFDf2688f92c85064bE0b929693ACC6dBcA6', // BPT of an 80-20 BAL-WETH Pool using test BAL
  },
  goerli: {
    BPT: '0xf8a0623ab66F985EfFc1C69D05F1af4BaDB01b00', // BPT of an 80-20 BAL-WETH Pool using test BAL
  },
};
