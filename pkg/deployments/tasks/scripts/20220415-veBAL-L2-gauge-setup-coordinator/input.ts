import Task, { TaskMode } from '../../../src/task';

export type veBALL2GaugeSetupCoordinatorDeployment = {
  AuthorizerAdaptor: string;
  VotingEscrow: string;
  GaugeAdder: string;
  EthereumGaugeFactory: string;
  PolygonRootGaugeFactory: string;
  ArbitrumRootGaugeFactory: string;
};

const AuthorizerAdaptor = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY);
const VotingEscrow = new Task('20220325-gauge-controller', TaskMode.READ_ONLY);
const GaugeAdder = new Task('20220325-gauge-adder', TaskMode.READ_ONLY);
const LiquidityGaugeFactory = new Task('20220325-mainnet-gauge-factory', TaskMode.READ_ONLY);
const PolygonRootGaugeFactory = new Task('20220413-polygon-root-gauge-factory', TaskMode.READ_ONLY);
const ArbitrumRootGaugeFactory = new Task('20220413-arbitrum-root-gauge-factory', TaskMode.READ_ONLY);

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
