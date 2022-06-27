import { simulateSwap } from '../weighted-pools/swaps';
import { simulateExactTokensInJoin, simulateSingleTokenJoin } from '../weighted-pools/joins';
import { simulateExactTokensOutExit, simulateSingleTokenExit } from '../weighted-pools/exits';
import WeightedPool from '../weighted-pools/model';
import { SwapKind } from '@balancer-labs/balancer-js';

async function main() {
  const SWAP_AMOUNT = 100;
  const WITHDRAWAL_PCT = 0.01;
  const DEPOSIT_PCT = 0.01;
  const TOTAL_LIQUIDITY = 100000;
  const SWAP_FEE = 0.005;

  let i;

  // Create a pool with the specified tokens and weights
  const pool = new WeightedPool(['BAL', 'WETH'], [0.8, 0.2], SWAP_FEE);
  // Initialize with total liquidity and prices
  pool.initialize(TOTAL_LIQUIDITY, [12, 2800]);

  const balIndex = pool.indexOf('BAL');
  const wethIndex = pool.indexOf('WETH');

  // These "simulate" functions were designed for a very specific purpose - testing the behavior over
  // the full range of swap fee values (1%-99%). They write CSV files in a format that can be imported
  // to Excel and graphed.
  //
  // Of course it is more general: you can create a simulated pool with any number of tokens and starting
  // liquidity (it will calculate the balances, given the token prices in USD), and perform operations to
  // inspect the results.
  //
  // Running `yarn ts-node scripts/weightedPool.ts` from the /simulators directory should produce
  // CSV files. This is just one example of what can be done with the simulated pool. For instance, new
  // tests could be created for /benchmarks.

  // Given BAL in, compute WETH out
  simulateSwap(
    pool,
    SwapKind.GivenIn,
    `Swap Fee,Amount ${wethIndex} Out,Value In,Value Out,Loss %\n`,
    'swapGivenIn.csv',
    SWAP_AMOUNT,
    balIndex,
    wethIndex
  );
  // Given BAL out, compute WETH in
  simulateSwap(
    pool,
    SwapKind.GivenOut,
    `Swap Fee,Amount ${wethIndex} In,Value Out,Value In,Loss %\n`,
    'swapGivenOut.csv',
    SWAP_AMOUNT,
    wethIndex,
    balIndex
  );

  // Deposit x% of the liquidity, distributed equally over the tokens
  // Could also put in custom values, do it proportionally, etc.
  const totalValuePerToken = (TOTAL_LIQUIDITY * DEPOSIT_PCT) / pool.getNumTokens();

  const amounts: number[] = [];
  const prices = pool.getPrices();

  for (i = 0; i < pool.getNumTokens(); i++) {
    amounts[i] = totalValuePerToken / prices[i];
  }

  simulateExactTokensInJoin(pool, 'Swap Fee,BPT Out,Value In,Value Out,Loss %\n', 'exactTokensInJoin.csv', amounts);
  simulateExactTokensOutExit(pool, 'Swap Fee,BPT In,Value Out,Value In,Loss %\n', 'exactTokensOutExit.csv', amounts);

  const tokens = pool.getTokens();

  for (i = 0; i < pool.getNumTokens(); i++) {
    simulateSingleTokenJoin(
      pool,
      'Swap Fee,Amount In,BPT Value Out,Token Value In,Loss %\n',
      `singleTokenJoin-${tokens[i]}.csv`,
      i,
      DEPOSIT_PCT
    );
  }

  for (let i = 0; i < pool.getNumTokens(); i++) {
    simulateSingleTokenExit(
      pool,
      'Swap Fee,Amount Out,Token Value Out,BPT Value In,Loss %\n',
      `singleTokenExit-${tokens[i]}.csv`,
      i,
      WITHDRAWAL_PCT
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
