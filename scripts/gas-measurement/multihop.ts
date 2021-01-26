import { encodeValidatorData, FundManagement, getTokensSwaps, toSwapIn } from '../helpers/trading';
import { TokenList } from '../../test/helpers/tokens';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { getWeightedPool, getStablePool, printGas, setupEnvironment, tokenSymbols } from './misc';
import { MAX_UINT128, MAX_UINT256 } from '../../test/helpers/constants';

let vault: Contract;
let validator: Contract;
let tokens: TokenList;

let trader: SignerWithAddress;

const MAX_HOPS = 6;

async function main() {
  ({ vault, validator, tokens, trader } = await setupEnvironment());

  console.log('== One token in for one token out, multiple hops ==');

  console.log(`\n# Weighted Pool with 2 tokens`);

  await multihop((index: number) => getWeightedPool(vault, tokens, 2, index), false);
  await multihop((index: number) => getWeightedPool(vault, tokens, 2, index), true);

  console.log(`\n# Weighted Pool with 4 tokens`);

  await multihop((index: number) => getWeightedPool(vault, tokens, 4, index), false);
  await multihop((index: number) => getWeightedPool(vault, tokens, 4, index), true);

  console.log(`\n# Stable Pool with 2 tokens`);

  await multihop((index: number) => getStablePool(vault, tokens, 2, index), false);
  await multihop((index: number) => getStablePool(vault, tokens, 2, index), true);

  console.log(`\n# Stable Pool with 4 tokens`);

  await multihop((index: number) => getStablePool(vault, tokens, 4, index), false);
  await multihop((index: number) => getStablePool(vault, tokens, 4, index), true);
}

async function multihop(getPool: (index: number) => Promise<string>, useInternalBalance: boolean) {
  console.log(`\n## ${useInternalBalance ? 'Using Internal Balance' : 'Sending and receiving tokens'}`);

  const funds: FundManagement = {
    recipient: trader.address,
    fromInternalBalance: useInternalBalance,
    toInternalBalance: useInternalBalance,
  };

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
      await vault.connect(trader).batchSwapGivenIn(
        validator.address,
        encodeValidatorData({
          overallTokenIn,
          overallTokenOut,
          minimumAmountOut: 0,
          maximumAmountIn: MAX_UINT128,
          deadline: MAX_UINT256,
        }),
        toSwapIn(swaps),
        tokenAddresses,
        funds
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
