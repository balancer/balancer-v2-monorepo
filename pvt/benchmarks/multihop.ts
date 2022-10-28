import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { FundManagement, SwapKind } from '@balancer-labs/balancer-js';
import { MAX_INT256, MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { getTokensSwaps } from '@balancer-labs/v2-helpers/src/models/vault/swaps';
import { getWeightedPool, getStablePool, setupEnvironment } from './misc';
import { fp, printGas } from '@balancer-labs/v2-helpers/src/numbers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

let vault: Vault;
let tokens: TokenList;
let trader: SignerWithAddress;

const MAX_HOPS = 3;

async function main() {
  ({ vault, tokens, trader } = await setupEnvironment());

  console.log('== One token in for one token out, multiple hops ==');

  console.log(`\n# Weighted Pool with 2 tokens`);

  await multihop((index: number) => getWeightedPool(vault, tokens, 2, index), false);
  await multihop((index: number) => getWeightedPool(vault, tokens, 2, index), true);

  console.log(`\n# Weighted Pool with 4 tokens`);

  await multihop((index: number) => getWeightedPool(vault, tokens, 4, index), false);
  await multihop((index: number) => getWeightedPool(vault, tokens, 4, index), true);

  console.log(`\n# Weighted Pool with 8 tokens`);

  await multihop((index: number) => getWeightedPool(vault, tokens, 8, index), false);
  await multihop((index: number) => getWeightedPool(vault, tokens, 8, index), true);

  console.log(`\n# Managed Pool with 38 tokens`);

  await multihop((index: number) => getWeightedPool(vault, tokens, 38, index), false);
  await multihop((index: number) => getWeightedPool(vault, tokens, 38, index), true);

  console.log(`\n# Managed Pool with 50 tokens`);

  await multihop((index: number) => getWeightedPool(vault, tokens, 50, index), false);
  await multihop((index: number) => getWeightedPool(vault, tokens, 50, index), true);

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
    sender: trader.address,
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
      const tokenIn = tokens.get(index);
      const tokenOut = tokens.get(index + 1);

      const trade = { poolId, tokenIn, tokenOut };

      if (index == 0) {
        return { ...trade, amount: fp(0.1).toString() };
      } else {
        return trade;
      }
    });

    const [tokenAddresses, swaps] = getTokensSwaps(tokens, trades);

    const receipt = await (
      await vault.instance
        .connect(trader)
        .batchSwap(
          SwapKind.GivenIn,
          swaps,
          tokenAddresses,
          funds,
          Array(tokenAddresses.length).fill(MAX_INT256),
          MAX_UINT256
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
