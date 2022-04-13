import Task from '../../src/task';

export type ChildChainLiquidityGaugeFactoryDeployment = {
  AuthorizerAdaptor: string;
  BAL: string;
  Vault: string;
};

const AuthorizerAdaptor = new Task('20220325-authorizer-adaptor');
const Vault = new Task('20210418-vault');

export default {
  AuthorizerAdaptor,
  Vault,
  polygon: {
    BAL: '0x9a71012B13CA4d3D0Cdc72A177DF3ef03b0E76A3',
  },
  arbitrum: {
    BAL: '0x040d1EdC9569d4Bab2D15287Dc5A4F10F56a56B8',
  },
};
