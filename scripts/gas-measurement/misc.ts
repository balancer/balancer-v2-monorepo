import { deploy } from '../helpers/deploy';
import { ethers } from 'hardhat';
import { deployTokens, mintTokens, TokenList } from '../../test/helpers/tokens';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { MAX_UINT256 } from '../../test/helpers/constants';
import { PairTS, setupPool, TradingStrategyType, TupleTS } from '../helpers/pools';
import { toFixedPoint } from '../helpers/fixedPoint';

export const tokenSymbols = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF'];

export async function setupEnvironment(): Promise<{
  vault: Contract;
  script: Contract;
  tokens: TokenList;
  trader: SignerWithAddress;
}> {
  const { trader } = await getSigners();

  const vault = await deploy('Vault', { args: [] });

  const script = await deploy('TradeScript', { args: [vault.address] });

  const tokens = await deployTokens(tokenSymbols);

  for (const symbol in tokens) {
    // trader tokens are used to trade and not have non-zero balances
    await mintTokens(tokens, symbol, trader, 200e18);
    await tokens[symbol].connect(trader).approve(vault.address, MAX_UINT256);

    // deposit user balance for trader to make it non-zero
    await vault.connect(trader).deposit(tokens[symbol].address, (1e18).toString(), trader.address);

    // Approve script to use tokens
    await vault.connect(trader).authorizeOperator(script.address);
  }

  return { vault, script, tokens, trader };
}

export type TradingStrategy = 'CWP' | 'Flattened';

export async function setupStrategyAndPool(
  strategyKind: TradingStrategy,
  vault: Contract,
  tokens: TokenList
): Promise<string> {
  const symbols = Object.keys(tokens);

  const { strategy, strategyType } = await setupTradingStrategy(strategyKind, tokens);
  const { controller } = await getSigners();

  return setupPool(
    vault,
    strategy,
    strategyType,
    tokens,
    controller,
    symbols.map((symbol) => [symbol, (100e18).toString()])
  );
}

async function getSigners(): Promise<{ trader: SignerWithAddress; controller: SignerWithAddress }> {
  const [, trader, controller] = await ethers.getSigners();

  return { trader, controller };
}

async function setupTradingStrategy(
  strategyKind: TradingStrategy,
  tokens: TokenList
): Promise<{ strategy: Contract; strategyType: TradingStrategyType }> {
  const symbols = Object.keys(tokens);

  if (strategyKind == 'CWP') {
    const strategy = await deploy('CWPTradingStrategy', {
      args: [
        symbols.map((symbol) => tokens[symbol].address),
        Array(symbols.length).fill(toFixedPoint(1)), // Equal weight to all tokens
        toFixedPoint(0.02), // 2% fee
      ],
    });

    return { strategy, strategyType: PairTS };
  } else if (strategyKind == 'Flattened') {
    const strategy = await deploy('FlattenedTradingStrategy', {
      args: [
        (30e18).toString(), // amp
        toFixedPoint(0.02), // 2% fee
      ],
    });

    return { strategy, strategyType: TupleTS };
  } else {
    throw new Error(`Unknown trading strategy kind: ${strategyKind}`);
  }
}

export function printGas(gas: number | BigNumber): string {
  if (typeof gas !== 'number') {
    gas = gas.toNumber();
  }

  return `${(gas / 1000).toFixed(1)}k`;
}
