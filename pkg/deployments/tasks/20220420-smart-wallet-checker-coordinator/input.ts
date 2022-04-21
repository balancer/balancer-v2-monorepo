import Task from '../../src/task';

export type SmartWalletCheckerCoordinatorDeployment = {
  AuthorizerAdaptor: string;
  VotingEscrow: string;
  SmartWalletChecker: string;
};

const AuthorizerAdaptor = new Task('20220325-authorizer-adaptor');
const VotingEscrow = new Task('20220325-gauge-controller');
const SmartWalletChecker = new Task('20220420-smart-wallet-checker');

export default {
  AuthorizerAdaptor,
  VotingEscrow,
  SmartWalletChecker,
};
