import Task from '../../src/task';

export type MerkleRedeemDeployment = {
  Vault: string;
  balToken: string;
};

const Vault = new Task('20210418-vault');

export default {
  arbitrum: {
    Vault,
    balToken: '0x040d1edc9569d4bab2d15287dc5a4f10f56a56b8',
  },
};
