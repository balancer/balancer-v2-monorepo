import Task, { TaskMode } from '../../src/task';

export type SmartWalletCheckerDeployment = {
  Vault: string;
  InitialAllowedAddresses: string[];
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);

export default {
  Vault,
  mainnet: {
    // TribeDAO's contract, from https://vote.balancer.fi/#/proposal/0xece898cf86f930dd150f622a4ccb1fa41900e67b3cebeb4fc7c5a4acbb0e0148
    InitialAllowedAddresses: ['0xc4EAc760C2C631eE0b064E39888b89158ff808B2'],
  },
  goerli: {
    InitialAllowedAddresses: [],
  },
};
