import Task, { TaskMode } from '../../src/task';

export type ProtocolFeesWithdrawerDeployment = {
  Vault: string;
  InitialDeniedTokens: string[];
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);

export default {
  Vault,
  mainnet: {
    InitialDeniedTokens: [
      '0xfe18be6b3bd88a2d2a7f928d00292e7a9963cfc6', // sBTC
      '0x18FcC34bdEaaF9E3b69D2500343527c0c995b1d6', // sBTC (Implementation)
      '0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F', // SNX
      '0x931933807c4c808657b6016f9e539486e7b5d374', // SNX (Implementation)
    ],
  },
  polygon: {
    InitialDeniedTokens: [],
  },
  arbitrum: {
    InitialDeniedTokens: [],
  },
  optimism: {
    InitialDeniedTokens: [],
  },
  goerli: {
    InitialDeniedTokens: [],
  },
};
