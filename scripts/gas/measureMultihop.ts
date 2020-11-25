import { deploy } from '../helpers/deploy';
import { ethers } from 'hardhat';
import { getTokensSwaps, toSwapIn } from '../helpers/trading';
import { setupPool } from '../helpers/pools';
import { deployTokens, mintTokens, TokenList } from '../../test/helpers/tokens';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { MAX_UINT256 } from '../../test/helpers/constants';
import { toFixedPoint } from '../helpers/fixedPoint';
import { printGas } from './misc';

let vault: Contract;
let script: Contract;
let tokens: TokenList;

let controller: SignerWithAddress;
let trader: SignerWithAddress;

const tokenNames = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH', 'III'];

// for flattened
const amp = (30e18).toString();

async function main() {
  [, controller, trader] = await ethers.getSigners();

  vault = await deploy('Vault', { args: [] });

  script = await deploy('TradeScript', { args: [vault.address] });

  tokens = await deployTokens(tokenNames);

  for (const symbol in tokens) {
    // controller tokens are used to initialize pools
    await mintTokens(tokens, symbol, controller, 100e18);

    // Approve script to use tokens
    await vault.connect(trader).authorizeOperator(script.address);
  }

  // trader is given the first token in the chain
  const firstTokenSymbol = tokenNames[0];

  // trader tokens are used to trade and not have non-zero balances
  await mintTokens(tokens, firstTokenSymbol, trader, 200e18);
  await tokens[firstTokenSymbol].connect(trader).approve(vault.address, MAX_UINT256);

  // deposit user balance for trader to make it non-zero
  await vault.connect(trader).deposit(tokens[firstTokenSymbol].address, (1e18).toString(), trader.address);

  await batchedSwap('CWPTradingStrategy', true);
  await batchedSwap('CWPTradingStrategy', false);
  await batchedSwap('FlattenedTradingStrategy', true);
  await batchedSwap('FlattenedTradingStrategy', false);
}

async function batchedSwap(strategyName: string, withdrawTokens: boolean) {
  console.log(
    `# Multihop ${strategyName} TS Batched swap: multiple batched pools across different pairs ${
      withdrawTokens ? '' : 'not withdrawing tokens'
    }`
  );

  const isCWP = strategyName == 'CWPTradingStrategy';

  const pools: Array<string> = [];

  for (let i = 0; i < tokenNames.length - 1; ++i) {
    const tokenAName = tokenNames[i];
    const tokenBName = tokenNames[i + 1];

    const strategy = isCWP
      ? await deploy(strategyName, {
          args: [[tokens[tokenAName].address, tokens[tokenBName].address], [50, 50], toFixedPoint(0.02)], // 2% fee
        })
      : await deploy(strategyName, { args: [amp, (0.02e18).toString()] }); // 2% fee

    const strategyType: number = isCWP ? 0 : 1;

    pools.push(
      await setupPool(vault, strategy, strategyType, tokens, controller, [
        [tokenAName, (100e18).toString()],
        [tokenBName, (100e18).toString()],
      ])
    );
  }
  const amountsFlattened = [500, 490, 480, 470, 461, 452, 443, 434];

  for (let numPools = 1; numPools <= tokenNames.length - 1; ++numPools) {
    const poolSlice = pools.slice(0, numPools);
    const trades = poolSlice.map((poolId, i) => {
      const tokenIn = tokenNames[i];
      const tokenOut = tokenNames[i + 1];

      const amount = isCWP ? 500 : amountsFlattened[i];

      return { poolId, tokenIn, tokenOut, amount };
    });

    const [tokenAddresses, swaps] = getTokensSwaps(tokens, trades);

    const overallTokenIn = tokens[tokenNames[0]].address;
    const lastTokenName = tokenNames[numPools];
    const overallTokenOut = tokens[lastTokenName].address;
    const swapIn = toSwapIn(swaps);

    const receipt = await (
      await script.connect(trader).swapExactAmountIn(
        {
          overallTokenIn,
          overallTokenOut,
          minAmountOut: 400,
          maxAmountIn: 500,
        },
        swapIn,
        tokenAddresses,
        withdrawTokens
      )
    ).wait();

    console.log(
      `Using ${numPools} pools: ${printGas(receipt.gasUsed)} (${printGas(
        receipt.gasUsed / numPools
      )} per pool) ${tokenNames.slice(0, numPools + 1).join(' -> ')}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
