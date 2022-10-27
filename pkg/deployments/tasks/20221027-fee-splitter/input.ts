export type FeeSplitterDeployement = {
  protocolFeesWithdrawer: string;
  treasury: string;
};

export default {
  mainnet: {
    protocolFeesWithdrawer: '0x5ef4c5352882b10893b70DbcaA0C000965bd23c5',
    treasury: '0x10a19e7ee7d7f8a52822f6817de8ea18204f2e4f',
  },
  goerli: {
    protocolFeesWithdrawer: '0x85153B639a35d6e6CF8B291Aca237FbE67377154',
    treasury: '0x10a19e7ee7d7f8a52822f6817de8ea18204f2e4f',
  },
};
