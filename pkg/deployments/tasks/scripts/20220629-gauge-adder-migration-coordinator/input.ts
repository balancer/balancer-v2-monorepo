import Task, { TaskMode } from '../../../src/task';

export type GaugeAdderMigrationCoordinatorDeployment = {
  AuthorizerAdaptor: string;
  OldGaugeAdder: string;
  NewGaugeAdder: string;
  ArbitrumRootGaugeFactory: string;
  OptimismRootGaugeFactory: string;
  LiquidityMiningMultisig: string;
  GaugeCheckpointingMultisig: string;
};

const AuthorizerAdaptor = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY);
const OldGaugeAdder = new Task('20220325-gauge-adder', TaskMode.READ_ONLY);
const NewGaugeAdder = new Task('20220628-gauge-adder-v2', TaskMode.READ_ONLY);

const ArbitrumRootGaugeFactory = new Task('20220413-arbitrum-root-gauge-factory', TaskMode.READ_ONLY);
const OptimismRootGaugeFactory = new Task('20220628-optimism-root-gauge-factory', TaskMode.READ_ONLY);

// Placeholders
const LiquidityMiningMultisig = '0x0000000000000000000000000000000000000420';
const GaugeCheckpointingMultisig = '0x0000000000000000000000000000000000000421';

export default {
  mainnet: {
    AuthorizerAdaptor,
    OldGaugeAdder: OldGaugeAdder.output({ network: 'mainnet' }).GaugeAdder,
    NewGaugeAdder: NewGaugeAdder.output({ network: 'mainnet' }).GaugeAdder,
    ArbitrumRootGaugeFactory,
    OptimismRootGaugeFactory,
    LiquidityMiningMultisig,
    GaugeCheckpointingMultisig,
  },
};
