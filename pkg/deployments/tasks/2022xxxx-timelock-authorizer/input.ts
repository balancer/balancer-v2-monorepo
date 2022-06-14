import Task, { TaskMode } from '../../src/task';

export type RoleData = {
  role: string;
  target: string;
};

export type TimelockAuthorizerDeployment = {
  Vault: string;
  Authorizer: string;
  root: string;
  rolesData: RoleData[];
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const Authorizer = new Task('20210418-authorizer', TaskMode.READ_ONLY);

export default {
  Vault,
  Authorizer,
  mainnet: {
    root: '0xE0a171587b1Cae546E069A943EDa96916F5EE977',
    rolesData: [
      {
        role: '0xb28b769768735d011b267f781c3be90bce51d5059ba015bc7a28b3e882fb2083',
        target: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
      },
      {
        role: '0x2256d78edacd087428321791a930d4f9fd7acf56e8862187466f1caf179c1a08',
        target: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
      },
      {
        role: '0x1e3ce02b9d143fb44dc00c908d6b454553cf1c8c48e54090fa1f5fdd18a8e6b9',
        target: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
      },
    ],
  },
};
