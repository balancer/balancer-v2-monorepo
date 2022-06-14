import Task, { TaskMode } from '../../../src/task';

export type SNXRecoveryCoordinatorDeployment = {
  AuthorizerAdaptor: string;
  ProtocolFeesWithdrawer: string;
  tokens: string[];
  amounts: string[];
};

const AuthorizerAdaptor = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY);
const ProtocolFeesWithdrawer = new Task('20220517-protocol-fee-withdrawer', TaskMode.READ_ONLY);

// Mainnet
const MAINNET_sBTC = '0xfe18be6b3bd88a2d2a7f928d00292e7a9963cfc6';
const MAINNET_SNX = '0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F';
const MAINNET_TOKENS = [MAINNET_SNX, MAINNET_sBTC];

const MAINNET_sBTC_AMOUNT = '273030307592426881329'; // Note that sBTC has 18 decimals of precision.
const MAINNET_SNX_AMOUNT = '937727163854831767449517';
const MAINNET_AMOUNTS = [MAINNET_SNX_AMOUNT, MAINNET_sBTC_AMOUNT];

// Optimism
const OPTIMISM_sUSD = '0x8c6f28f2f1a3c87f0f938b96d27520d9751ec8d9';
const OPTIMISM_SNX = '0x8700daec35af8ff88c16bdf0418774cb3d7599b4';
const OPTIMISM_TOKENS = [OPTIMISM_SNX, OPTIMISM_sUSD];

const OPTIMISM_sUSD_AMOUNT = '22143443690237097991858';
const OPTIMISM_SNX_AMOUNT = '5169589929780230696166';
const OPTIMISM_AMOUNTS = [OPTIMISM_SNX_AMOUNT, OPTIMISM_sUSD_AMOUNT];

export default {
  AuthorizerAdaptor,
  ProtocolFeesWithdrawer,
  mainnet: {
    tokens: MAINNET_TOKENS,
    amounts: MAINNET_AMOUNTS,
  },
  optimism: {
    tokens: OPTIMISM_TOKENS,
    amounts: OPTIMISM_AMOUNTS,
  },
};
