import { NAMES, INDICES, PRICES, BALANCES, TOTAL_LIQUIDITY } from "./config";
import { simulateSwap, swapGivenIn, swapGivenOut } from "./swaps";
import { simulateExactTokensInJoin, simulateSingleTokenJoin } from "./joins"
import { simulateExactTokensOutExit, simulateSingleTokenExit } from "./exits"

async function main() {
  const SWAP_AMOUNT = 100;
  const WITHDRAWAL_PCT = 0.01;
  const DEPOSIT_PCT = 0.01;
  let i;

  // Given BAL in, compute WETH out
  simulateSwap(`Swap Fee,Amount ${INDICES['WETH']} Out,Value In,Value Out,Loss %\n`, 'swapGivenIn.csv', SWAP_AMOUNT, INDICES['BAL'], INDICES['WETH'], swapGivenIn);
  // Given BAL out, compute WETH in
  simulateSwap(`Swap Fee,Amount ${INDICES['WETH']} In,Value Out,Value In,Loss %\n`, 'swapGivenOut.csv', SWAP_AMOUNT, INDICES['WETH'], INDICES['BAL'], swapGivenOut);

  // Deposit x% of the liquidity, distributed equally over the tokens
  // Could also put in custom values, do it proportionally, etc.
  const totalValuePerToken = TOTAL_LIQUIDITY * DEPOSIT_PCT / BALANCES.length;

  const amounts: number[] = [];
  for (i = 0; i < BALANCES.length; i++) {
    amounts[i] = totalValuePerToken / PRICES[i];
  }

  simulateExactTokensInJoin('Swap Fee,BPT Out,Value In,Value Out,Loss %\n', 'exactTokensInJoin.csv', amounts);
  simulateExactTokensOutExit('Swap Fee,BPT In,Value Out,Value In,Loss %\n', 'exactTokensOutExit.csv', amounts);

  for (i = 0; i < NAMES.length; i++) {
    simulateSingleTokenJoin('Swap Fee,Amount In,BPT Value Out,Token Value In,Loss %\n', `singleTokenJoin-${NAMES[i]}.csv`, i, DEPOSIT_PCT);
  }

  for (let i = 0; i < NAMES.length; i++) {
    simulateSingleTokenExit('Swap Fee,Amount Out,Token Value Out,BPT Value In,Loss %\n', `singleTokenExit-${NAMES[i]}.csv`, i, WITHDRAWAL_PCT);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
