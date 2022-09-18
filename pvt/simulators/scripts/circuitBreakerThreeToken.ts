import { expect } from 'chai';
import WeightedPool from '../weighted-pools/model';

function main() {
  const TOTAL_LIQUIDITY = 100000;
  const SWAP_FEE = 0.0001;
  const LOWER_BOUND = 0.9;
  const UPPER_BOUND = 2;
  const TOKENS = ['BAL', 'WETH'];
  const WEIGHTS = [0.79, 0.21];
  const PRICES = [10, 2000];

  const twoPool = new WeightedPool(TOKENS, WEIGHTS, SWAP_FEE);
  const threePool = new WeightedPool(TOKENS.concat('USDC'), [0.79, 0.2, 0.01], SWAP_FEE);

  // Initialize with total liquidity and prices
  twoPool.initialize(TOTAL_LIQUIDITY, PRICES);
  twoPool.setCircuitBreaker('BAL', LOWER_BOUND, UPPER_BOUND);

  threePool.initialize(TOTAL_LIQUIDITY, PRICES.concat(1));
  threePool.setCircuitBreaker('BAL', LOWER_BOUND, UPPER_BOUND);

  let preSwapBalances = twoPool.getBalances();
  let preSwapBptPrice = twoPool.getBptPrice('BAL');
  console.log(`preSwap Balances: ${preSwapBalances}`);
  console.log(`preSwap BPT Price: ${preSwapBptPrice}`);
  let bounds = twoPool.getCircuitBreakerBptPriceBounds('BAL');
  console.log(`Bounds: ${JSON.stringify(bounds)}`);
  let preSwapSpotPrice = twoPool.getSpotPrice('BAL', 'WETH');

  let [postSwapBAL, postSwapWETH] = twoPool.getPostSwapBalancesGivenPriceRatio('BAL', 'WETH', LOWER_BOUND);
  let postSwapBptPrice = (twoPool.getTotalSupply() * twoPool.getWeight('BAL')) / postSwapBAL;
  console.log(`postSwap Balances: ${postSwapBAL}, ${postSwapWETH}`);
  console.log(`postSwap BPT Price:  ${postSwapBptPrice}`);
  let postSwapSpotPrice = twoPool.getSpotPrice('BAL', 'WETH', [postSwapBAL, postSwapWETH]);
  console.log(`Spot prices: ${preSwapSpotPrice} -> ${postSwapSpotPrice}`);
  expect(postSwapSpotPrice.toFixed(5)).to.equal((preSwapSpotPrice * LOWER_BOUND).toFixed(5));

  [postSwapBAL, postSwapWETH] = twoPool.getPostSwapBalancesGivenPriceRatio('BAL', 'WETH', UPPER_BOUND);
  postSwapBptPrice = (twoPool.getTotalSupply() * twoPool.getWeight('BAL')) / postSwapBAL;
  console.log(`postSwap Balances: ${postSwapBAL}, ${postSwapWETH}`);
  console.log(`postSwap BPT Price:  ${postSwapBptPrice}`);

  console.log('----- THREE TOKEN ------');

  preSwapBalances = threePool.getBalances();
  preSwapBptPrice = threePool.getBptPrice('BAL');
  console.log(`preSwap Balances: ${preSwapBalances}`);
  console.log(`preSwap BPT Price: ${preSwapBptPrice}`);
  bounds = threePool.getCircuitBreakerBptPriceBounds('BAL');
  console.log(`Bounds: ${JSON.stringify(bounds)}`);
  preSwapSpotPrice = threePool.getSpotPrice('BAL', 'WETH');

  [postSwapBAL, postSwapWETH] = threePool.getPostSwapBalancesGivenPriceRatio('BAL', 'WETH', LOWER_BOUND);
  postSwapBptPrice = (threePool.getTotalSupply() * threePool.getWeight('BAL')) / postSwapBAL;
  console.log(`postSwap Balances: ${postSwapBAL}, ${postSwapWETH}`);
  console.log(`postSwap BPT Price:  ${postSwapBptPrice}`);
  postSwapSpotPrice = threePool.getSpotPrice('BAL', 'WETH', [postSwapBAL, postSwapWETH]);
  console.log(`Spot prices: ${preSwapSpotPrice} -> ${postSwapSpotPrice}`);
  expect(postSwapSpotPrice.toFixed(5)).to.equal((preSwapSpotPrice * LOWER_BOUND).toFixed(5));

  [postSwapBAL, postSwapWETH] = threePool.getPostSwapBalancesGivenPriceRatio('BAL', 'WETH', UPPER_BOUND);
  postSwapBptPrice = (threePool.getTotalSupply() * threePool.getWeight('BAL')) / postSwapBAL;
  console.log(`postSwap Balances: ${postSwapBAL}, ${postSwapWETH}`);
  console.log(`postSwap BPT Price:  ${postSwapBptPrice}`);
}

main();
