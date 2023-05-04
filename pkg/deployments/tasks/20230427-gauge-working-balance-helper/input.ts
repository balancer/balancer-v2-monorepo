import Task, { TaskMode } from '../../src/task';

export type GaugeWorkingBalanceHelperDeployment = {
  VotingEscrowDelegationProxy: string;
  ReadTotalSupplyFromVE: boolean;
};

export default {
  mainnet: {
    VotingEscrowDelegationProxy: new Task('20220325-ve-delegation', TaskMode.READ_ONLY).output({ network: 'mainnet' })
      .VotingEscrowDelegationProxy,
    ReadTotalSupplyFromVE: true,
  },
  goerli: {
    VotingEscrowDelegationProxy: new Task('20220325-ve-delegation', TaskMode.READ_ONLY).output({ network: 'goerli' })
      .VotingEscrowDelegationProxy,
    ReadTotalSupplyFromVE: true,
  },
  arbitrum: {
    VotingEscrowDelegationProxy: new Task('20230316-l2-ve-delegation-proxy', TaskMode.READ_ONLY).output({
      network: 'arbitrum',
    }).VotingEscrowDelegationProxy,
    ReadTotalSupplyFromVE: false,
  },
  gnosis: {
    VotingEscrowDelegationProxy: new Task('20230316-l2-ve-delegation-proxy', TaskMode.READ_ONLY).output({
      network: 'gnosis',
    }).VotingEscrowDelegationProxy,
    ReadTotalSupplyFromVE: false,
  },
  optimism: {
    VotingEscrowDelegationProxy: new Task('20230316-l2-ve-delegation-proxy', TaskMode.READ_ONLY).output({
      network: 'optimism',
    }).VotingEscrowDelegationProxy,
    ReadTotalSupplyFromVE: false,
  },
  polygon: {
    VotingEscrowDelegationProxy: new Task('20230316-l2-ve-delegation-proxy', TaskMode.READ_ONLY).output({
      network: 'polygon',
    }).VotingEscrowDelegationProxy,
    ReadTotalSupplyFromVE: false,
  },
};
