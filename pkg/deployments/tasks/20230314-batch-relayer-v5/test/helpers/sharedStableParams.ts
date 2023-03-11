import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { bn, fp, FP_ZERO } from '@balancer-labs/v2-helpers/src/numbers';

export const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f';
export const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

export const tokens = [DAI, USDC];
export const amplificationParameter = bn(100);
export const swapFeePercentage = fp(0.01);
export const initialBalanceDAI = fp(1e6);
export const initialBalanceUSDC = fp(1e6).div(1e12); // 6 digits
export const initialBalances = [initialBalanceDAI, initialBalanceUSDC];
export const rateProviders = [ZERO_ADDRESS, ZERO_ADDRESS];
export const cacheDurations = [FP_ZERO, FP_ZERO];
export const exemptFlags = [false, false];

export enum PoolKind {
  WEIGHTED = 0,
  LEGACY_STABLE,
  COMPOSABLE_STABLE,
  COMPOSABLE_STABLE_V2,
}
