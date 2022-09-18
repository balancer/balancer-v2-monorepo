import { expect } from 'chai';
import WeightedPool from '../weighted-pools/model';

function main() {
  const TOTAL_LIQUIDITY = 100000;
  const SWAP_FEE = 0.0001;
  const LOWER_BOUND = 0.8;
  const UPPER_BOUND = 2.0;
  const TOKENS = ['BAL', 'WETH'];
  const WEIGHTS = [0.8, 0.2];
  const PRICES = [10, 2000];

  const pool = new WeightedPool(TOKENS, WEIGHTS, SWAP_FEE);

  // Initialize with total liquidity and prices
  pool.initialize(TOTAL_LIQUIDITY, PRICES);
  pool.setCircuitBreaker('BAL', LOWER_BOUND, UPPER_BOUND);

  const preSwapBalances = pool.getBalances();
  const preSwapBptPrice = pool.getBptPrice('BAL');
  console.log(`PreSwap balances: ${preSwapBalances}`);
  console.log(`PresSwap BPT Price: ${preSwapBptPrice}`);

  // Now experiment with changing weights
  // Set the price to the lower bound, then ensure changing weights don't trigger it
  let [postSwapBAL] = pool.getPostSwapBalancesGivenPriceRatio('BAL', 'WETH', LOWER_BOUND);
  let postSwapBptPrice = (pool.getTotalSupply() * pool.getWeight('BAL')) / postSwapBAL;
  expect(pool.circuitBreakerLowerBoundTripped('BAL', postSwapBptPrice)).to.be.false;

  for (let weightDelta = 0.01; weightDelta < 0.2; weightDelta += 0.01) {
    pool.setWeights([WEIGHTS[0] + weightDelta, WEIGHTS[1] - weightDelta]);

    const currentBALWeight = pool.getWeight('BAL');

    [postSwapBAL] = pool.getPostSwapBalancesGivenPriceRatio('BAL', 'WETH', LOWER_BOUND);

    postSwapBptPrice = (pool.getTotalSupply() * currentBALWeight) / postSwapBAL;
    //const bounds = pool.getCircuitBreakerBptPriceBounds('BAL', currentBALWeight);

    expect(pool.circuitBreakerLowerBoundTripped('BAL', postSwapBptPrice, currentBALWeight)).to.be.false;
  }
}

main();
