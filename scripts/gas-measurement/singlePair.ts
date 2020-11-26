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

const MAX_POOLS = 8;

async function main() {
  ({ vault, script, tokens, trader } = await setupEnvironment());

  console.log('== Single token pair in multiple pools ==');

  console.log(`\n# Constant Weighted Product Trading Strategy`);

  await singlePair(() => getCWPPool(vault, tokens), false);
  await singlePair(() => getCWPPool(vault, tokens), true);

  console.log(`\n# Flattened Trading Strategy with 2 tokens`);

  await singlePair(() => getFlattenedPool(vault, tokens, 2), false);
  await singlePair(() => getFlattenedPool(vault, tokens, 2), true);

  console.log(`\n# Flattened Trading Strategy with 4 tokens`);

  await singlePair(() => getFlattenedPool(vault, tokens, 4), false);
  await singlePair(() => getFlattenedPool(vault, tokens, 4), true);
}

async function singlePair(getPool: () => Promise<string>, withdrawTokens: boolean) {
  console.log(`\n## ${withdrawTokens ? 'Withdrawing tokens' : 'Depositing into User Balance'}`);

  const pools: Array<string> = [];
  for (let i = 0; i < MAX_POOLS; ++i) {
    pools.push(await getPool());
  }

  // Trade token 0 for token 1, putting 500 of 0 into each pool
  const tokenIn = tokenSymbols[0];
  const tokenOut = tokenSymbols[1];

  for (let poolAmount = 1; poolAmount <= MAX_POOLS; ++poolAmount) {
    const [tokenAddresses, swaps] = getTokensSwaps(
      tokens,
      pools.slice(0, poolAmount).map((poolId) => {
        return { poolId, tokenIn, tokenOut, amount: 500 };
      })
    );

    const receipt = await (
      await script.connect(trader).swapExactAmountIn(
        {
          overallTokenIn: tokens[tokenIn].address,
          overallTokenOut: tokens[tokenOut].address,
          minAmountOut: 0,
          maxAmountIn: MAX_UINT128,
        },
        toSwapIn(swaps),
        tokenAddresses,
        withdrawTokens
      )
    ).wait();

    console.log(
      `${poolAmount} pools: ${printGas(receipt.gasUsed)} (${printGas(receipt.gasUsed / poolAmount)} per pool)`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
