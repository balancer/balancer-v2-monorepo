import { ethers, deployments } from 'hardhat';
import { deployTokens, TokenList } from '../../test/helpers/tokens';
import { BigNumber, Contract, ContractFactory } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { MAX_UINT256 } from '../../test/helpers/constants';
import { PairTS, setupPool, TradingStrategyType, TupleTS } from '../helpers/pools';
import { toFixedPoint } from '../helpers/fixedPoint';
import { pick } from 'lodash';

export const tokenSymbols = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH', 'III'];

export async function setupEnvironment(): Promise<{
  vault: Contract;
  validator: Contract;
  tokens: TokenList;
  trader: SignerWithAddress;
}> {
  const { admin, trader, controller } = await getSigners();
  await deployments.fixture();
  const vault = await ethers.getContract('Vault');
  const validator = await ethers.getContract('OneToOneSwapValidator');

  const tokens = await deployTokens(admin.address, tokenSymbols, Array(tokenSymbols.length).fill(18));

  for (const symbol in tokens) {
    // trader tokens are used to trade and not have non-zero balances
    await tokens[symbol].connect(admin).mint(trader.address, (200e18).toString());
    await tokens[symbol].connect(admin).grantRole(ethers.utils.id('MINTER_ROLE'), controller.address);
    await tokens[symbol].connect(trader).approve(vault.address, MAX_UINT256);

    // deposit user balance for trader to make it non-zero
    await vault.connect(trader).deposit(tokens[symbol].address, (1e18).toString(), trader.address);
  }

  return { vault, validator, tokens, trader };
}

export type TradingStrategy = 'CWP' | 'Flattened';

export async function setupStrategyAndPool(
  strategyKind: TradingStrategy,
  vault: Contract,
  tokens: TokenList
): Promise<string> {
  const symbols = Object.keys(tokens);

  const { strategy, strategyType } = await setupTradingStrategy(strategyKind, tokens);
  const { admin, controller } = await getSigners();

  return setupPool(
    vault,
    strategy,
    strategyType,
    tokens,
    admin,
    controller,
    symbols.map((symbol) => [symbol, (100e18).toString()])
  );
}

export async function getCWPPool(vault: Contract, tokens: TokenList): Promise<string> {
  return setupStrategyAndPool('CWP', vault, tokens);
}

export async function getFlattenedPool(
  vault: Contract,
  tokens: TokenList,
  size: number,
  offset?: number
): Promise<string> {
  return setupStrategyAndPool('Flattened', vault, pick(tokens, tokenSymbols.slice(offset ?? 0, size + (offset ?? 0))));
}

async function getSigners(): Promise<{
  admin: SignerWithAddress;
  trader: SignerWithAddress;
  controller: SignerWithAddress;
}> {
  const [, admin, trader, controller] = await ethers.getSigners();

  return { admin, trader, controller };
}

async function setupTradingStrategy(
  strategyKind: TradingStrategy,
  tokens: TokenList
): Promise<{ strategy: Contract; strategyType: TradingStrategyType }> {
  const symbols = Object.keys(tokens);

  if (strategyKind == 'CWP') {
    const CWPTradingStrategyFactory: ContractFactory = await ethers.getContractFactory('CWPTradingStrategy');
    const strategy = await CWPTradingStrategyFactory.deploy(
      {
        // Equal weight to all tokens
        isMutable: false,
        tokens: symbols.map((symbol) => tokens[symbol].address),
        weights: Array(symbols.length).fill(toFixedPoint(1)),
      },
      { isMutable: false, value: toFixedPoint(0.02) } // 2% swap fee
    );

    return { strategy, strategyType: PairTS };
  } else if (strategyKind == 'Flattened') {
    const FlattenedStrategyFactory: ContractFactory = await ethers.getContractFactory('FlattenedTradingStrategy');
    const strategy = await FlattenedStrategyFactory.deploy(
      { isMutable: false, value: (30e18).toString() }, // amp
      { isMutable: false, value: toFixedPoint(0.02) } // 2% swap fee
    );

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
