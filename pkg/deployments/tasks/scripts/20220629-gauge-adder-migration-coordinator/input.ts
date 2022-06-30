import Task, { TaskMode } from '../../../src/task';

export type GaugeAdderMigrationCoordinatorDeployment = {
  AuthorizerAdaptor: string;
  OldGaugeAdder: string;
  NewGaugeAdder: string;
  OptimismRootGaugeFactory: string;
  LiquidityMiningMultisig: string;
};

const AuthorizerAdaptor = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY);
const OldGaugeAdder = new Task('20220325-gauge-adder', TaskMode.READ_ONLY);
const NewGaugeAdder = new Task('20220628-gauge-adder-v2', TaskMode.READ_ONLY);

const PolygonRootGaugeFactory = new Task('20220413-polygon-root-gauge-factory', TaskMode.READ_ONLY);

// Placeholders
const OptimismRootGaugeFactory = PolygonRootGaugeFactory.output({ network: 'mainnet' }).PolygonRootGaugeFactory;
const LiquidityMiningMultisig = '0x0000000000000000000000000000000000000420';

export default {
  mainnet: {
    AuthorizerAdaptor,
    OldGaugeAdder: OldGaugeAdder.output({ network: 'mainnet' }).GaugeAdder,
    NewGaugeAdder: NewGaugeAdder.output({ network: 'mainnet' }).GaugeAdder,
    OptimismRootGaugeFactory,
    LiquidityMiningMultisig,
  },
};
