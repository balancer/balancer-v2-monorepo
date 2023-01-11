import Task, { TaskMode } from '../../../src/task';

export type GaugeAdderMigrationCoordinatorDeployment = {
  AuthorizerAdaptor: string;
  OldGaugeAdder: string;
  NewGaugeAdder: string;
  LiquidityGaugeFactory: string;
  PolygonRootGaugeFactory: string;
  ArbitrumRootGaugeFactory: string;
  OptimismRootGaugeFactory: string;
  LiquidityMiningMultisig: string;
  GaugeCheckpointingMultisig: string;
};

const AuthorizerAdaptor = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY);
const OldGaugeAdder = new Task('20220628-gauge-adder-v2', TaskMode.READ_ONLY);
const NewGaugeAdder = new Task('20230109-gauge-adder-v3', TaskMode.READ_ONLY);

const LiquidityGaugeFactory = new Task('20220822-mainnet-gauge-factory-v2', TaskMode.READ_ONLY);
const PolygonRootGaugeFactory = new Task('20220823-polygon-root-gauge-factory-v2', TaskMode.READ_ONLY);
const ArbitrumRootGaugeFactory = new Task('20220823-arbitrum-root-gauge-factory-v2', TaskMode.READ_ONLY);
const OptimismRootGaugeFactory = new Task('20220823-optimism-root-gauge-factory-v2', TaskMode.READ_ONLY);

const LiquidityMiningMultisig = '0xc38c5f97b34e175ffd35407fc91a937300e33860';
const GaugeCheckpointingMultisig = '0x02f35dA6A02017154367Bc4d47bb6c7D06C7533B';

export default {
  mainnet: {
    AuthorizerAdaptor,
    OldGaugeAdder: OldGaugeAdder.output({ network: 'mainnet' }).GaugeAdder,
    NewGaugeAdder: NewGaugeAdder.output({ network: 'mainnet' }).GaugeAdder,
    LiquidityGaugeFactory,
    PolygonRootGaugeFactory,
    ArbitrumRootGaugeFactory,
    OptimismRootGaugeFactory,
    LiquidityMiningMultisig,
    GaugeCheckpointingMultisig,
  },
};
