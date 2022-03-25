import Task from '../../src/task';

export type veBALDeploymentCoordinatorDeployment = {
  AuthorizerAdaptor: string;
  BalancerMinter: string;
  GaugeAdder: string;
  LiquidityGaugeFactory: string;
  SingleRecipientGaugeFactory: string;
  BALTokenHolderFactory: string;
  activationScheduledTime: string;
  thirdStageDelay: string;
};

const BalancerMinter = new Task('20220325-gauge-controller');
const AuthorizerAdaptor = new Task('20220325-authorizer-adaptor');
const GaugeAdder = new Task('20220325-gauge-adder');
const LiquidityGaugeFactory = new Task('20220325-mainnet-gauge-factory');
const SingleRecipientGaugeFactory = new Task('20220325-single-recipient-gauge-factory');
const BALTokenHolderFactory = new Task('20220325-bal-token-holder-factory');

export default {
  AuthorizerAdaptor,
  BalancerMinter,
  GaugeAdder,
  LiquidityGaugeFactory,
  SingleRecipientGaugeFactory,
  BALTokenHolderFactory,
  mainnet: {
    activationScheduledTime: '1648465200', // Monday, March 28, 2022 11:00:00 AM
    thirdStageDelay: '691200', // 8 days
  },
  kovan: {
    activationScheduledTime: '1647459355',
    thirdStageDelay: '600',
  },
};
