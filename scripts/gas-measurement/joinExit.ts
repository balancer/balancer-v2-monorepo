import { deployTokens, mintTokens, TokenList } from '../../test/helpers/tokens';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { getSigners, printGas, tokenSymbols } from './misc';
import { deploy } from '../helpers/deploy';
import { MAX_UINT256 } from '../../test/helpers/constants';
import { toFixedPoint } from '../helpers/fixedPoint';
import { deployPoolFromFactory, PoolName } from '../helpers/pools';
import { pick } from 'lodash';
import { assert } from 'console';

const TEN = (10e18).toString();

let vault: Contract;
let tokens: TokenList;

let trader: SignerWithAddress;

export async function setupEnvironment(
  userBalanceDepositAmount: number
): Promise<{
  vault: Contract;
  validator: Contract;
  tokens: TokenList;
  trader: SignerWithAddress;
}> {
  const { admin, trader, creator } = await getSigners();

  const vault = await deploy('Vault', { args: [admin.address] });

  const validator = await deploy('OneToOneSwapValidator', { args: [] });

  const tokens = await deployTokens(tokenSymbols, Array(tokenSymbols.length).fill(18));

  for (const symbol in tokens) {
    // creator tokens are used to add liquidity to pools, but minted when required
    await tokens[symbol].connect(creator).approve(vault.address, MAX_UINT256);

    // trader tokens are used to trade and not have non-zero balances
    await mintTokens(tokens, symbol, trader, 200e18);
    await tokens[symbol].connect(trader).approve(vault.address, MAX_UINT256);

    // deposit user balance for trader to make it non-zero
    if (userBalanceDepositAmount > 1) {
      const toDeposit = (userBalanceDepositAmount * 1e18).toString();
      await vault.connect(trader).deposit(tokens[symbol].address, toDeposit, trader.address);
    }
  }

  return { vault, validator, tokens, trader };
}

async function main() {
  // Do not deposit anything to user balance
  // So calculate gas for transferring all tokens
  const userBalance = 100;

  ({ vault, tokens, trader } = await setupEnvironment(userBalance));

  const poolTypes = ['ConstantProductPool', 'StablecoinPool'];
  let transferTokens: boolean;

  for (let typeIdx = 0; typeIdx < 2; typeIdx++) {
    for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
      for (let x = 0; x <= 1; x++) {
        transferTokens = 0 == x ? true : false;

        await joinPoolTokenTransfer(
          () => getPool(vault, poolTypes[typeIdx] as PoolName, numTokens),
          poolTypes[typeIdx] as PoolName,
          numTokens,
          transferTokens
        );
      }
    }
  }
}

async function joinPoolTokenTransfer(
  getPool: () => Promise<Contract>,
  poolType: string,
  numTokens: number,
  transferTokens: boolean
) {
  const pool: Contract = await getPool();

  let receipt = await (
    await pool.connect(trader).joinPool(TEN, Array(numTokens).fill(TEN), transferTokens, trader.address)
  ).wait();

  let bpt = await pool.balanceOf(trader.address);
  assert(bpt == 10e18, 'Did not actually join pool');

  const transfer = transferTokens ? 'Transferring tokens' : 'With User Balance';

  console.log(`${printGas(receipt.gasUsed)} gas for joining a ${poolType} with ${numTokens} tokens (${transfer})`);

  receipt = await (
    await pool.connect(trader).exitPool(TEN, Array(numTokens).fill(0), transferTokens, trader.address)
  ).wait();

  bpt = await pool.balanceOf(trader.address);
  assert(bpt == 0, 'Did not actually exit pool');

  console.log(`${printGas(receipt.gasUsed)} gas for exiting a ${poolType} with ${numTokens} tokens (${transfer})`);
}

export async function getPool(vault: Contract, poolType: PoolName, size: number): Promise<Contract> {
  return deployPool(vault, pick(tokens, tokenSymbols.slice(0, size)), poolType);
}

export async function deployPool(vault: Contract, tokens: TokenList, poolName: PoolName): Promise<Contract> {
  const { admin, creator } = await getSigners();

  const symbols = Object.keys(tokens);

  const tokenBalance = (100e18).toString();
  for (const symbol of symbols) {
    await mintTokens(tokens, symbol, creator, tokenBalance);
  }

  const initialBPT = (100e18).toString();
  const tokenAddresses = symbols.map((symbol) => tokens[symbol].address);
  const initialBalances = symbols.map(() => tokenBalance);

  const swapFee = toFixedPoint(0.02); // 2%

  let pool: Contract;

  if (poolName == 'ConstantProductPool') {
    const weights = symbols.map(() => toFixedPoint(1)); // Equal weights for all tokens

    pool = await deployPoolFromFactory(vault, admin, 'ConstantProductPool', {
      from: creator,
      parameters: [initialBPT, tokenAddresses, initialBalances, weights, swapFee],
    });
  } else if (poolName == 'StablecoinPool') {
    const amp = (30e18).toString();

    pool = await deployPoolFromFactory(vault, admin, 'StablecoinPool', {
      from: creator,
      parameters: [initialBPT, tokenAddresses, initialBalances, amp, swapFee],
    });
  } else {
    throw new Error(`Unhandled pool: ${poolName}`);
  }

  return pool;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
