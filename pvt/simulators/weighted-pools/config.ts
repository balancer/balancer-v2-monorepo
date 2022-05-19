export const TOTAL_LIQUIDITY = 100000;

export const NAMES = ['BAL', 'WETH'];
export const INDICES = { 'BAL': 0, 'WETH': 1};

export const PRICES = [12, 2800];
export const WEIGHTS = [0.8, 0.2];

export const MAX_IN_RATIO = 0.3;
export const MAX_OUT_RATIO = 0.3;

export const MAX_INVARIANT_RATIO = 3;
export const MIN_INVARIANT_RATIO = 0.7;

// Compute the balances from the weights and total liquidity
export const BALANCES: number[] = [];

for (let i = 0; i < PRICES.length; i++) {
  BALANCES[i] = TOTAL_LIQUIDITY * WEIGHTS[i] / PRICES[i];
}

export function getInitialTotalSupply(): number {
  let totalSupply = 2;

  for (let i = 0; i < BALANCES.length; i++) {
    totalSupply *= BALANCES[i] ** WEIGHTS[i];
  }

  return totalSupply;
}