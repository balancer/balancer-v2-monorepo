import Task, { TaskMode } from '../../src/task';

export type FeeSplitterDeployement = {
  ProtocolFeesWithdrawer: string;
  treasury: string;
};

const ProtocolFeesWithdrawer = new Task('20220517-protocol-fee-withdrawer', TaskMode.READ_ONLY);

export default {
  ProtocolFeesWithdrawer,
  mainnet: {
    treasury: '0x10a19e7ee7d7f8a52822f6817de8ea18204f2e4f',
  },
  goerli: {
    treasury: '0x10a19e7ee7d7f8a52822f6817de8ea18204f2e4f',
  },
};
