import Task, { TaskMode } from '../../../src/task';

export type SmartWalletCheckerCoordinatorDeployment = {
  AuthorizerAdaptor: string;
  VotingEscrow: string;
  SmartWalletChecker: string;
};

const AuthorizerAdaptor = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY);
const VotingEscrow = new Task('20220325-gauge-controller', TaskMode.READ_ONLY);
const SmartWalletChecker = new Task('20220420-smart-wallet-checker', TaskMode.READ_ONLY);

export default {
  AuthorizerAdaptor,
  VotingEscrow,
  SmartWalletChecker,
};
