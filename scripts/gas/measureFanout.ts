import { deploy } from '../helpers/deploy';
import { ethers } from 'hardhat';
import { getTokensSwaps, toSwapIn } from '../helpers/trading';
import { setupPool } from '../helpers/pools';
import { deployTokens, mintTokens, TokenList } from '../../test/helpers/tokens';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { MAX_UINT256 } from '../../test/helpers/constants';
import { vaultStats, printGas } from './setup';

let vault: Contract;
let script: Contract;
let tokens: TokenList;

let controller: SignerWithAddress;
let trader: SignerWithAddress;

const tokenNames = ['AAA', 'BBB', 'CCC', 'DDD'];

// for flattened
const amp = (30e18).toString();

async function main() {
  [, controller, trader] = await ethers.getSigners();

  vault = await deploy('Vault', { args: [] });

  await vaultStats(vault);

  script = await deploy('TradeScript', { args: [vault.address] });

  tokens = await deployTokens(tokenNames);
  //console.log(Object.entries(tokens).map(([k, t]) => k + " " + t.address).join('\n'))

  for (const symbol in tokens) {
    // controller tokens are used to initialize pools
    await mintTokens(tokens, symbol, controller, 100e18);

    // trader tokens are used to trade and not have non-zero balances
    await mintTokens(tokens, symbol, trader, 200e18);
    await tokens[symbol].connect(trader).approve(vault.address, MAX_UINT256);

    // deposit user balance for trader to make it non-zero
    await vault.connect(trader).deposit(tokens[symbol].address, (1e18).toString(), trader.address);

    // Approve script to use tokens
    await vault.connect(trader).authorizeOperator(script.address);
  }

  await batchedSwap('CWPTradingStrategy', false);
  await batchedSwap('CWPTradingStrategy', true);
  await batchedSwap('FlattenedTradingStrategy', false);
  await batchedSwap('FlattenedTradingStrategy', true);
}

async function batchedSwap(strategyName: string, withdrawTokens: boolean) {
  console.log(`# ${strategyName} TS Batched swap: Fanout ${withdrawTokens ? '' : 'not withdrawing tokens'}`);

  // Diamond Trade
  //                      AAA
  //                      /  \
  //                    BBB  CCC
  //                     \   /
  //                      DDD

  const poolIds: { [key: string]: string } = {};
  const poolNames = [
    ['AAA', 'BBB'],
    ['AAA', 'CCC'],
    ['BBB', 'DDD'],
    ['CCC', 'DDD'],
  ];
  const poolAmount = poolNames.length;

  const isCWP = strategyName == 'CWPTradingStrategy';
  await Promise.all(
    poolNames.map(async ([tokenAName, tokenBName]) => {
      const fee = (0.02e18).toString();
      const strategy = isCWP
        ? await deploy(strategyName, {
            args: [[tokens[tokenAName].address, tokens[tokenBName].address], [50, 50], fee], // 2% fee
          })
        : await deploy(strategyName, { args: [amp, fee] }); // 2% fee

      const strategyType: number = isCWP ? 0 : 1;

      poolIds[tokenAName + tokenBName] = await setupPool(vault, strategy, strategyType, tokens, controller, [
        [tokenAName, (100e18).toString()],
        [tokenBName, (100e18).toString()],
      ]);
    })
  );

  const tradesCWP = [
    { poolId: poolIds['AAABBB'], tokenIn: 'AAA', tokenOut: 'BBB', amount: 300 },
    { poolId: poolIds['AAACCC'], tokenIn: 'AAA', tokenOut: 'CCC', amount: 200 },
    { poolId: poolIds['BBBDDD'], tokenIn: 'BBB', tokenOut: 'DDD', amount: 300 },
    { poolId: poolIds['CCCDDD'], tokenIn: 'CCC', tokenOut: 'DDD', amount: 200 },
  ];

  const tradesFlattened = [
    { poolId: poolIds['AAABBB'], tokenIn: 'AAA', tokenOut: 'BBB', amount: 300 },
    { poolId: poolIds['AAACCC'], tokenIn: 'AAA', tokenOut: 'CCC', amount: 200 },
    { poolId: poolIds['BBBDDD'], tokenIn: 'BBB', tokenOut: 'DDD', amount: 294 },
    { poolId: poolIds['CCCDDD'], tokenIn: 'CCC', tokenOut: 'DDD', amount: 196 },
  ];

  const trades = isCWP ? tradesCWP : tradesFlattened;

  const [tokenAddresses, swaps] = getTokensSwaps(tokens, trades);

  const receipt = await (
    await script.connect(trader).swapExactAmountIn(
      {
        overallTokenIn: tokens.AAA.address,
        overallTokenOut: tokens.DDD.address,
        minAmountOut: 480,
        maxAmountIn: 500,
      },
      toSwapIn(swaps),
      tokenAddresses,
      withdrawTokens
    )
  ).wait();

  console.log(
    `Using a graph trade with 1 middle layer (${poolAmount} trades): ${printGas(receipt.gasUsed)} (${printGas(
      receipt.gasUsed / poolAmount
    )} per pool)`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
