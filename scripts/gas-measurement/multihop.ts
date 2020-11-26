import { getTokensSwaps, toSwapIn } from '../helpers/trading';
import { TokenList } from '../../test/helpers/tokens';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { getCWPPool, getFlattenedPool, printGas, setupEnvironment, tokenSymbols } from './misc';
import { MAX_UINT128 } from '../../test/helpers/constants';

let vault: Contract;
let script: Contract;
let tokens: TokenList;

let trader: SignerWithAddress;

const MAX_HOPS = 6;

async function main() {
  ({ vault, script, tokens, trader } = await setupEnvironment());

  console.log('== One token in for one token out, multiple hops ==');

  console.log(`\n# Constant Weighted Product Trading Strategy`);

  await multihop(() => getCWPPool(vault, tokens), false);
  await multihop(() => getCWPPool(vault, tokens), true);

  console.log(`\n# Flattened Trading Strategy with 2 tokens`);

  await multihop((index: number) => getFlattenedPool(vault, tokens, 2, index), false);
  await multihop((index: number) => getFlattenedPool(vault, tokens, 2, index), true);

  console.log(`\n# Flattened Trading Strategy with 4 tokens`);

  await multihop((index: number) => getFlattenedPool(vault, tokens, 4, index), false);
  await multihop((index: number) => getFlattenedPool(vault, tokens, 4, index), true);
}

async function multihop(getPool: (index: number) => Promise<string>, withdrawTokens: boolean) {
  console.log(`\n## ${withdrawTokens ? 'Withdrawing tokens' : 'Depositing into User Balance'}`);

  const pools: Array<string> = [];
  for (let i = 0; i < MAX_HOPS + 1; ++i) {
    // To do n hops, we need n+1 pools
    pools.push(await getPool(i));
  }

  for (let numHops = 1; numHops <= MAX_HOPS; ++numHops) {
    const trades = pools.slice(0, numHops).map((poolId, index) => {
      const tokenIn = tokenSymbols[index];
      const tokenOut = tokenSymbols[index + 1];

      const trade = { poolId, tokenIn, tokenOut };

      if (index == 0) {
        return { ...trade, amount: 500 };
      } else {
        return trade;
      }
    });

    const [tokenAddresses, swaps] = getTokensSwaps(tokens, trades);

    const overallTokenIn = tokenAddresses[swaps[0].tokenInIndex];
    const overallTokenOut = tokenAddresses[swaps[swaps.length - 1].tokenOutIndex];

    const receipt = await (
      await script.connect(trader).swapExactAmountIn(
        {
          overallTokenIn,
          overallTokenOut,
          minAmountOut: 0,
          maxAmountIn: MAX_UINT128,
        },
        toSwapIn(swaps),
        tokenAddresses,
        withdrawTokens
      )
    ).wait();

    console.log(`${numHops} hops: ${printGas(receipt.gasUsed)} (${printGas(receipt.gasUsed / numHops)} per swap)`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
