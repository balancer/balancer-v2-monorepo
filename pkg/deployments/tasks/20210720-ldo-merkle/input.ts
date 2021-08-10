import Task from '../../src/task';

export type MerkleRedeemDeployment = {
  vault: string;
  ldoToken: string;
};

const vault = new Task('20210418-vault');
const ldoToken = '0x5a98fcbea516cf06857215779fd812ca3bef1b32'; // Ethereum mainnet

export default {
  vault,
  ldoToken,
};
