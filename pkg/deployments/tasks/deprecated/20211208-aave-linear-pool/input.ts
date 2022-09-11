<<<<<<< HEAD:pkg/deployments/tasks/20211208-aave-linear-pool/input.ts
import Task, { TaskMode } from '../../src/task';

export type AaveLinearPoolDeployment = {
  Vault: string;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);

export default {
  Vault,
};
=======
import Task, { TaskMode } from '../../../src/task';

export type AaveLinearPoolDeployment = {
  Vault: string;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);

export default {
  Vault,
};
>>>>>>> c3ccf89dac6f9b5fd6b8642ce84a0893998701e0:pkg/deployments/tasks/deprecated/20211208-aave-linear-pool/input.ts
