<<<<<<< HEAD:pkg/deployments/tasks/deprecated/20210920-vita-merkle/input.ts
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
=======
import Task, { TaskMode } from '../../../src/task';

export type WeightedPoolDeployment = {
  Vault: string;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);

export default {
  Vault,
};
>>>>>>> c3ccf89dac6f9b5fd6b8642ce84a0893998701e0:pkg/deployments/tasks/deprecated/20210418-weighted-pool/input.ts
