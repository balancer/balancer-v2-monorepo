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

const MAX_POOLS = 8;

async function main() {
  ({ vault, validator, tokens, trader } = await setupEnvironment());

  console.log('== Single token pair in multiple pools ==');

  console.log(`\n# Weighted Pools with 2 tokens`);

  await singlePair(() => getWeightedPool(vault, tokens, 2), false);
  await singlePair(() => getWeightedPool(vault, tokens, 2), true);

  console.log(`\n# Weighted Pools with 4 tokens`);

  await singlePair(() => getWeightedPool(vault, tokens, 4), false);
  await singlePair(() => getWeightedPool(vault, tokens, 4), true);

  console.log(`\n# Stable Pools with 2 tokens`);

  await singlePair(() => getStablePool(vault, tokens, 2), false);
  await singlePair(() => getStablePool(vault, tokens, 2), true);

  console.log(`\n# Stable Pools with 4 tokens`);

  await singlePair(() => getStablePool(vault, tokens, 4), false);
  await singlePair(() => getStablePool(vault, tokens, 4), true);
}

async function singlePair(getPoolId: () => Promise<string>, useInternalBalance: boolean) {
  console.log(`\n## ${useInternalBalance ? 'Using Internal Balance' : 'Sending and receiving tokens'}`);

  const funds: FundManagement = {
    recipient: trader.address,
    fromInternalBalance: useInternalBalance,
    toInternalBalance: useInternalBalance,
  };

  const poolIds: Array<string> = [];
  for (let i = 0; i < MAX_POOLS; ++i) {
    poolIds.push(await getPoolId());
  }

  // Trade token 0 for token 1, putting 500 of 0 into each pool
  const tokenIn = tokenSymbols[0];
  const tokenOut = tokenSymbols[1];

  for (let poolAmount = 1; poolAmount <= MAX_POOLS; ++poolAmount) {
    const [tokenAddresses, swaps] = getTokensSwaps(
      tokens,
      poolIds.slice(0, poolAmount).map((poolId) => {
        return { poolId, tokenIn, tokenOut, amount: 500 };
      })
    );

    const receipt = await (
      await vault.connect(trader).batchSwapGivenIn(
        validator.address,
        encodeValidatorData({
          overallTokenIn: tokens[tokenIn].address,
          overallTokenOut: tokens[tokenOut].address,
          minimumAmountOut: 0,
          maximumAmountIn: MAX_UINT128,
          deadline: MAX_UINT256,
        }),
        toSwapIn(swaps),
        tokenAddresses,
        funds
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
