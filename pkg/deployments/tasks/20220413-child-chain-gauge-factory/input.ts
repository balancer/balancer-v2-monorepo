import Task, { TaskMode } from '../../src/task';

export type ChildChainLiquidityGaugeFactoryDeployment = {
  AuthorizerAdaptor: string;
  BAL: string;
  Vault: string;
};

const AuthorizerAdaptor = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY);
const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const Tokens = new Task('00000000-tokens', TaskMode.READ_ONLY);

export default {
  AuthorizerAdaptor,
  Vault,
  polygon: {
    BAL: Tokens.output({ network: 'polygon' }).BAL,
  },
  arbitrum: {
    BAL: Tokens.output({ network: 'arbitrum' }).BAL,
  },
  optimism: {
    BAL: Tokens.output({ network: 'optimism' }).BAL,
  },
  goerli: {
    BAL: Tokens.output({ network: 'goerli' }).BAL,
  },
};
