import Task, { TaskMode } from '../../src/task';

type CreateBoostCall = {
  delegator: string;
  receiver: string;
  percentage: number;
  cancel_time: number;
  expire_time: number;
  id: number;
};

type SetApprovalForAllCall = {
  operator: string;
  delegator: string;
};

export type PreseededVotingEscrowDelegationDeployment = {
  VotingEscrow: string;
  AuthorizerAdaptor: string;
  PreseededBoostCalls: CreateBoostCall[];
  PreseededApprovalCalls: SetApprovalForAllCall[];
};

const VotingEscrow = new Task('gauge-controller', TaskMode.READ_ONLY);
const AuthorizerAdaptor = new Task('authorizer-adaptor', TaskMode.READ_ONLY);

export default {
  VotingEscrow,
  AuthorizerAdaptor,
  mainnet: {
    PreseededBoostCalls: [
      {
        // tx: 0x511697e1ab960ffb225254f12d2992287a3784ade116f60ca171d842e074c2d9
        delegator: '0x7f01D9b227593E033bf8d6FC86e634d27aa85568',
        receiver: '0x3A11F4c84688a1264690d696D8D807a25Ee02dd2',
        percentage: 10000,
        cancel_time: 0,
        expire_time: 1680739200,
        id: 0,
      },
      {
        // tx: 0x278cd32c77aa9ff54cf1adff5e977b944a1d577bbd7513e81bd78b95dde3f59a
        delegator: '0xc2593E6A71130e7525Ec3e64ba7795827086dF0a',
        receiver: '0x8e430636c5Dc436Cc5A91A0CFF6eD2fA782987Bb',
        percentage: 10000,
        cancel_time: 0,
        expire_time: 1680739200,
        id: 0,
      },
      {
        // tx: 0xb1647dfc30b6d3b102802412124a72389eed5e9e9c2f848830ed646d79f25d5a
        delegator: '0xeF9A40F0ce782108233b6A5d8fef08C89B01A7BD',
        receiver: '0x0bf1D0dd1d1E2993F36aB6DD6dE5302E2f369871',
        percentage: 10000,
        cancel_time: 0,
        expire_time: 1678616754,
        id: 0,
      },
      // The boost from tx 0x19f0b43e423d61977c1acf2f9b48969080cf47319ff568744c6916f655f109d4 was cancelled in tx
      // 0xe3219f55fd8d7a08e08f804f8b32c821f7fd9d3d377abfe4594e83f6e2ae34b3, so we skip it.
      {
        // tx: 0x90dfc0b1c9a0da622dda509ce5ac9e1bc07f4ac24b246fddb0a60a593edf94cb
        delegator: '0x0035Fc5208eF989c28d47e552E92b0C507D2B318',
        receiver: '0x3217b819EA2d25f1982BaE5dD9C8Fe4C6D546bfC',
        percentage: 10000,
        cancel_time: 0,
        expire_time: 1684368000,
        id: 0,
      },
    ],
    PreseededApprovalCalls: [
      {
        // See https://forum.balancer.fi/t/tribe-dao-boost-delegation/3218
        operator: '0x66977Ce30049CD0e443216Bf26377966c3A109E2',
        delegator: '0xc4EAc760C2C631eE0b064E39888b89158ff808B2',
      },
    ],
  },
  goerli: {
    PreseededBoostCalls: [],
    PreseededApprovalCalls: [],
  },
};
