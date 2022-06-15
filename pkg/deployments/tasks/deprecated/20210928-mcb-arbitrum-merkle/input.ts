import Task, { TaskMode } from '../../../src/task';

export type MerkleRedeemDeployment = {
  Vault: string;
  rewardToken: string;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);

export default {
  arbitrum: {
    Vault,
    rewardToken: '0x4e352cf164e64adcbad318c3a1e222e9eba4ce42',
  },
};
