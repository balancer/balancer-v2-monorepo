import Task from '../../src/task';

export type SmartWalletCheckerDeployment = {
  Vault: string;
  initialAllowedAddresses: string[];
};

const Vault = new Task('20210418-vault');

export default {
  Vault,
  kovan: {
    initialAllowedAddresses: ['0x6a1E0696069355DB5B282ca33cDb66f66D6bCbe9'], // [Aura contract]
  },
};
