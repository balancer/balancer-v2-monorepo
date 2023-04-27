import Task, { TaskMode } from '../../src/task';

export type GaugeWorkingBalanceHelperDeployment = {
  L1VotingEscrowDelegationProxy: string;
  L2VotingEscrowDelegationProxy: string;
};

export default {
  mainnet: {
    L1VotingEscrowDelegationProxy: new Task('20220325-ve-delegation', TaskMode.READ_ONLY).output({ network: 'mainnet' })
      .VotingEscrowDelegationProxy,
    L2VotingEscrowDelegationProxy: '',
  },
  goerli: {
    L1VotingEscrowDelegationProxy: new Task('20220325-ve-delegation', TaskMode.READ_ONLY).output({ network: 'goerli' })
      .VotingEscrowDelegationProxy,
    L2VotingEscrowDelegationProxy: '',
  },
  arbitrum: {
    L1VotingEscrowDelegationProxy: '',
    L2VotingEscrowDelegationProxy: new Task('20230316-l2-ve-delegation-proxy', TaskMode.READ_ONLY).output({
      network: 'arbitrum',
    }).VotingEscrowDelegationProxy,
  },
  gnosis: {
    L1VotingEscrowDelegationProxy: '',
    L2VotingEscrowDelegationProxy: new Task('20230316-l2-ve-delegation-proxy', TaskMode.READ_ONLY).output({
      network: 'gnosis',
    }).VotingEscrowDelegationProxy,
  },
  optimism: {
    L1VotingEscrowDelegationProxy: '',
    L2VotingEscrowDelegationProxy: new Task('20230316-l2-ve-delegation-proxy', TaskMode.READ_ONLY).output({
      network: 'optimism',
    }).VotingEscrowDelegationProxy,
  },
  polygon: {
    L1VotingEscrowDelegationProxy: '',
    L2VotingEscrowDelegationProxy: new Task('20230316-l2-ve-delegation-proxy', TaskMode.READ_ONLY).output({
      network: 'polygon',
    }).VotingEscrowDelegationProxy,
  },
};
