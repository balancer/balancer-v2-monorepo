import WeightedPool from '../weighted-pools/model';
import fs from 'fs';

function simulateBounds(pool: WeightedPool, title: string, filename: string, endingValue: number): void {
  let data = `${title}\n`;
  // These aren't changing here
  const supply = pool.getTotalSupply();
  const balWeight = pool.getWeight('BAL');

  const delta = endingValue < 1 ? -0.01 : 0.01;

  for (let rawBound = 1; ; rawBound += delta) {
    const bound = Number(rawBound.toFixed(2));

    pool.setCircuitBreaker('BAL', bound < 1 ? bound : 0, endingValue > 1 ? bound : 0);

    const bounds = pool.getCircuitBreakerBptPriceBounds('BAL');
    const [postSwapBAL, postSwapWETH] = pool.getPostSwapBalancesGivenPriceRatio('BAL', 'WETH', bound);
    const preSwapSpotPrice = pool.getSpotPrice('BAL', 'WETH');
    const postSwapSpotPrice = pool.getSpotPrice('BAL', 'WETH', [postSwapBAL, postSwapWETH]);
    const postSwapBptPrice = (supply * balWeight) / postSwapBAL;

    data += `${bound},${bounds[endingValue < 1 ? 0 : 1]},${postSwapBptPrice},${postSwapBAL},${postSwapWETH},${
      bound * preSwapSpotPrice
    },${postSwapSpotPrice}\n`;

    if (bound == endingValue) {
      break;
    }
  }

  fs.writeFileSync(filename, data);
}

function simulateWeightChange(pool: WeightedPool, title: string, filename: string, bound: number): void {
  let data = `${title}\n`;
  // This isn't changing here
  const supply = pool.getTotalSupply();

  pool.setCircuitBreaker('BAL', bound < 1 ? bound : 0, bound > 1 ? bound : 0);
  const initialState = pool.getCircuitBreakerRatioBounds('BAL');
  console.log(`reference price: ${initialState.referencePrice}`);

  for (let rawWeight = pool.getWeight('BAL'); ; rawWeight -= 0.01) {
    const balWeight = Number(rawWeight.toFixed(2));
    const wethWeight = Number((1 - rawWeight).toFixed(2));
    if (balWeight == 0 || wethWeight == 1) {
      break;
    }

    pool.setWeights([balWeight, wethWeight]);

    const bounds = pool.getCircuitBreakerBptPriceBounds('BAL');
    const [postSwapBAL, postSwapWETH] = pool.getPostSwapBalancesGivenPriceRatio('BAL', 'WETH', bound);
    const postSwapBptPrice = (supply * pool.getWeight('BAL')) / postSwapBAL;

    data += `${balWeight},${wethWeight},${
      bounds[bound < 1 ? 0 : 1]
    },${postSwapBptPrice},${postSwapBAL},${postSwapWETH}\n`;
  }

  fs.writeFileSync(filename, data);
}

function main() {
  const TOTAL_LIQUIDITY = 100000;
  const LOWER_BOUND = 0.8;
  const SWAP_FEE = 0.0001;
  const TOKENS = ['BAL', 'WETH'];
  const WEIGHTS = [0.8, 0.2];
  const PRICES = [10, 2000];

  const pool = new WeightedPool(TOKENS, WEIGHTS, SWAP_FEE);

  // Initialize with total liquidity and prices
  pool.initialize(TOTAL_LIQUIDITY, PRICES);

  simulateBounds(
    pool,
    'Lower Bound,LB BPT Price,PostSwap BPT Price,BAL balance,WETH balance,LB*PreSwap Spot,PostSwap Spot',
    'lower_bounds_2token.csv',
    0.01
  );
  simulateBounds(
    pool,
    'Upper Bound,UB BPT Price,PostSwap BPT Price,BAL balance,WETH balance,UB*PreSwap Spot,PostSwap Spot',
    'upper_bounds_2token.csv',
    2
  );

  // Now change weights
  pool.initialize(TOTAL_LIQUIDITY, PRICES);
  simulateWeightChange(
    pool,
    'BAL Weight,WETH Weight,LB BPT Price,PostSwap BPT Price,BAL balance,WETH balance',
    'lower_bounds_wgt_change.csv',
    LOWER_BOUND
  );

  const threePool = new WeightedPool(TOKENS.concat('USDC'), [0.5, 0.3, 0.2], SWAP_FEE);
  threePool.initialize(TOTAL_LIQUIDITY, PRICES.concat(1));

  simulateBounds(
    threePool,
    'Lower Bound,LB BPT Price,PostSwap BPT Price,BAL balance,WETH balance,LB*PreSwap Spot,PostSwap Spot',
    'lower_bounds_3token.csv',
    0.01
  );
  simulateBounds(
    threePool,
    'Upper Bound,UB BPT Price,PostSwap BPT Price,BAL balance,WETH balance,UB*PreSwap Spot,PostSwap Spot',
    'upper_bounds_3token.csv',
    2
  );
}

main();
