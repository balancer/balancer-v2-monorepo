import Task, { TaskMode } from '../../../src/task';

export type MerkleRedeemDeployment = {
  Vault: string;
  rewardToken: string;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);

export default {
  mainnet: {
    Vault,
    rewardToken: '0x81f8f0bb1cB2A06649E51913A151F0E7Ef6FA321',
  },
};
