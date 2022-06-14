import Task, { TaskMode } from '../../../src/task';

export type MerkleRedeemDeployment = {
  Vault: string;
  balToken: string;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);

export default {
  arbitrum: {
    Vault,
    balToken: '0x040d1EdC9569d4Bab2D15287Dc5A4F10F56a56B8',
  },
};
