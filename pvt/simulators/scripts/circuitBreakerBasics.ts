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

  // A ratio of 1 should reproduce the current values
  const postSwapBalances = pool.getPostSwapBalancesGivenPriceRatio('BAL', 'WETH', 1);
  expect(postSwapBalances).to.deep.equal(preSwapBalances);

  let postSwapBptPrice = (pool.getTotalSupply() * pool.getWeight('BAL')) / postSwapBalances[0];
  expect(postSwapBptPrice).to.equal(preSwapBptPrice);
  expect(pool.circuitBreakerLowerBoundTripped('BAL', postSwapBptPrice)).to.be.false;

  // Try very low ratio (<< lower bound)
  let [postSwapBAL, postSwapWETH] = pool.getPostSwapBalancesGivenPriceRatio('BAL', 'WETH', 0.01);
  expect(postSwapBAL).to.gt(preSwapBalances[0]);
  expect(postSwapWETH).to.lt(preSwapBalances[1]);

  postSwapBptPrice = (pool.getTotalSupply() * pool.getWeight('BAL')) / postSwapBAL;
  expect(postSwapBptPrice).to.lt(preSwapBptPrice);
  expect(pool.circuitBreakerLowerBoundTripped('BAL', postSwapBptPrice)).to.be.true;
  expect(pool.circuitBreakerUpperBoundTripped('BAL', postSwapBptPrice)).to.be.false;

  // Try very large ratio (>> upper bound)
  [postSwapBAL, postSwapWETH] = pool.getPostSwapBalancesGivenPriceRatio('BAL', 'WETH', 2.5);
  expect(postSwapBAL).to.lt(preSwapBalances[0]);
  expect(postSwapWETH).to.gt(preSwapBalances[1]);

  postSwapBptPrice = (pool.getTotalSupply() * pool.getWeight('BAL')) / postSwapBAL;
  expect(postSwapBptPrice).to.gt(preSwapBptPrice);
  expect(pool.circuitBreakerLowerBoundTripped('BAL', postSwapBptPrice)).to.be.false;
  expect(pool.circuitBreakerUpperBoundTripped('BAL', postSwapBptPrice)).to.be.true;

  // Try a range of ratios to test correct general behavior
  for (const ratio of [0.2, 0.4, 0.6, 0.79, 0.8, 1.2, 1.4, 1.6, 1.8, 1.99, 2, 2.01, 5]) {
    const [postSwapBAL, postSwapWETH] = pool.getPostSwapBalancesGivenPriceRatio('BAL', 'WETH', ratio);
    postSwapBptPrice = (pool.getTotalSupply() * pool.getWeight('BAL')) / postSwapBAL;

    if (ratio <= LOWER_BOUND) {
      expect(postSwapBAL).to.gt(preSwapBalances[0]);
      expect(postSwapWETH).to.lt(preSwapBalances[1]);
      expect(pool.circuitBreakerLowerBoundTripped('BAL', postSwapBptPrice)).to.equal(ratio < LOWER_BOUND);
      expect(pool.circuitBreakerUpperBoundTripped('BAL', postSwapBptPrice)).to.be.false;
    } else if (ratio >= UPPER_BOUND) {
      expect(postSwapBAL).to.lt(preSwapBalances[0]);
      expect(postSwapWETH).to.gt(preSwapBalances[1]);

      expect(pool.circuitBreakerUpperBoundTripped('BAL', postSwapBptPrice)).to.equal(ratio > UPPER_BOUND);
      expect(pool.circuitBreakerLowerBoundTripped('BAL', postSwapBptPrice)).to.be.false;
    } else {
      // Within bounds
      expect(pool.circuitBreakerLowerBoundTripped('BAL', postSwapBptPrice)).to.be.false;
      expect(pool.circuitBreakerUpperBoundTripped('BAL', postSwapBptPrice)).to.be.false;
    }
  }
}

main();
