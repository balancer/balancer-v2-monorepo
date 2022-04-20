import Task from '../../src/task';

export type veBALL2GaugeSetupCoordinatorDeployment = {
  AuthorizerAdaptor: string;
  VotingEscrow: string;
  GaugeAdder: string;
  EthereumGaugeFactory: string;
  PolygonRootGaugeFactory: string;
  ArbitrumRootGaugeFactory: string;
};

const AuthorizerAdaptor = new Task('20220325-authorizer-adaptor');
const VotingEscrow = new Task('20220325-gauge-controller');
const GaugeAdder = new Task('20220325-gauge-adder');
const LiquidityGaugeFactory = new Task('20220325-mainnet-gauge-factory');
const PolygonRootGaugeFactory = new Task('20220413-polygon-root-gauge-factory');
const ArbitrumRootGaugeFactory = new Task('20220413-arbitrum-root-gauge-factory');

export default {
  mainnet: {
    AuthorizerAdaptor,
    VotingEscrow,
    GaugeAdder,
    EthereumGaugeFactory: LiquidityGaugeFactory.output({ network: 'mainnet' }).LiquidityGaugeFactory,
    PolygonRootGaugeFactory,
    ArbitrumRootGaugeFactory,
  },
};
