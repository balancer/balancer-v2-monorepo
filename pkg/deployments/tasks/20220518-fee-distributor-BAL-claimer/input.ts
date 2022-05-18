import Task, { TaskMode } from '../../src/task';

export type FeeDistributorBALClaimerDeployment = {
  AuthorizerAdaptor: string;
  FeeDistributor: string;
  Gauge: string;
};

const AuthorizerAdaptor = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY);
const FeeDistributor = new Task('20220420-fee-distributor', TaskMode.READ_ONLY);

export default {
  mainnet: {
    AuthorizerAdaptor,
    FeeDistributor,
    Gauge: '0xE867AD0a48e8f815DC0cda2CDb275e0F163A480b', // veBAL SingleRecipientGauge
  },
};
