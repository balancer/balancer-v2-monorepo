export type FeeSplitterDeployement = {
  protocolFeesCollectorAddress: string;
  treasury: string;
};

export default {
  mainnet: {
    protocolFeesCollectorAddress: '0xce88686553686da562ce7cea497ce749da109f9f',
    treasury: '0x10a19e7ee7d7f8a52822f6817de8ea18204f2e4f',
  },
  goerli: {
    protocolFeesCollectorAddress: '0xce88686553686da562ce7cea497ce749da109f9f',
    treasury: '0x10a19e7ee7d7f8a52822f6817de8ea18204f2e4f',
  },
};
