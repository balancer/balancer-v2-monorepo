import { TokenList } from '../../test/helpers/tokens';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { printGas, setupEnvironment, getConstantProductPool, getStablecoinPool } from './misc';
import { PoolName } from '../helpers/pools';
import { assert } from 'console';
import { ethers } from 'hardhat';

// setupEnvironmnt
const tokenAmount = BigNumber.from((10e18).toString());

let vault: Contract;
let tokens: TokenList;

let trader: SignerWithAddress;

async function main() {
  // Do not deposit anything to user balance
  // So calculate gas for transferring all tokens
  const userBalance = 100;
  let validator: Contract;

  /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
  ({ vault, validator, tokens, trader } = await setupEnvironment(userBalance));

  console.log('== Full join/exit (no initial BPT) ==');

  console.log(`\n# Constant Product Pools, full join/exit, transferring tokens`);

  // numTokens is the size of the pool: 2,4,6,8
  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    await joinAndExitPool(
      () => getConstantProductPool(vault, tokens, numTokens),
            'ConstantProductPool', numTokens, true);
  }

  console.log(`\n# Constant Product Pools, full join/exit, with user balance`);

  // numTokens is the size of the pool: 2,4,6,8
  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    await joinAndExitPool(
      () => getConstantProductPool(vault, tokens, numTokens),
            'ConstantProductPool', numTokens, false);
  }

  console.log(`\n# Stablecoin Pools, full join/exit, transferring tokens`);

  // numTokens is the size of the pool: 2,4,6,8
  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    await joinAndExitPool(
      () => getStablecoinPool(vault, tokens, numTokens),
            'StablecoinPool', numTokens, true);
  }

  console.log(`\n# Stablecoin Pools, full join/exit, with user balance`);

  // numTokens is the size of the pool: 2,4,6,8
  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    await joinAndExitPool(
      () => getStablecoinPool(vault, tokens, numTokens),
            'ConstantProductPool', numTokens, false);
  }

  console.log('== Partial Join/Exit (2-stage entry/exit)==');

  console.log(`\n# Constant Product Pools, partial join/exit, transferring tokens`);

  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    await joinAndExitPool(
      () => getConstantProductPool(vault, tokens, numTokens),
            'ConstantProductPool', numTokens, true, 2);
  }

  console.log(`\n# Constant Product Pools, partial join/exit, with user balance`);

  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    await joinAndExitPool(
      () => getConstantProductPool(vault, tokens, numTokens),
            'ConstantProductPool', numTokens, false, 2);
  }

  console.log(`\n# Stablecoin Pools, partial join/exit, transferring tokens`);

  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    await joinAndExitPool(
      () => getStablecoinPool(vault, tokens, numTokens),
            'StablecoinPool', numTokens, true, 2);
  }

  console.log(`\n# Stablecoin Pools, partial join/exit, with user balance`);

  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    await joinAndExitPool(
      () => getStablecoinPool(vault, tokens, numTokens),
            'StablecoinPool', numTokens, false, 2);
  }
}

async function joinAndExitPool(
  getPoolId: () => Promise<string>,
  poolType: string,
  numTokens: number,
  transferTokens: boolean,
  stageIdx = 1,
  showBalances = false
) {
  const poolId: string = await getPoolId();
  const [poolAddress] = await vault.fromPoolId(poolId);
  const pool: Contract = await ethers.getContractAt('ConstantProductPool', poolAddress);
  const transfer = transferTokens ? 'Transferring tokens' : 'With User Balance';
  let receipt;
  let bpt;

  if (showBalances && transferTokens) {
    await showTokenBalances('Initial', trader.address, poolId, numTokens);
  }

  for (let idx = 1; idx <= stageIdx; idx++) {
    receipt = await (
      await (pool as Contract)
        .connect(trader)
        .joinPool(tokenAmount, Array(numTokens).fill(tokenAmount), transferTokens, trader.address)
    ).wait();
    console.log(
      `${printGas(receipt.gasUsed)} gas for join ${idx} to a ${poolType} with ${numTokens} tokens (${transfer})`
    );

    bpt = await pool.balanceOf(trader.address);
    // check token balances
    assert(bpt.toString() == tokenAmount.mul(idx).toString(), 'Did not actually join pool');
    
    if (showBalances && transferTokens) {
      await showTokenBalances(`After join ${idx}`, trader.address, poolId, numTokens);
    }
  }

  // Now exit the pool
  for (let idx = 1; idx <= stageIdx; idx++) {
    if (idx > 1) {
      console.log('TODO: Need to fix; full exit reverts!');
      break;
    }

    receipt = await (
      await pool
        .connect(trader)
        .exitPool(tokenAmount, Array(numTokens).fill(0), transferTokens, trader.address)
    ).wait();
    console.log(
      `${printGas(receipt.gasUsed)} gas for exit ${idx} of a ${poolType} with ${numTokens} tokens (${transfer})`
    );

    if (showBalances && transferTokens) {
      await showTokenBalances(`After exit ${idx}`, trader.address, poolId, numTokens);
    }

    bpt = await pool.balanceOf(trader.address);
    assert(bpt.toString() == tokenAmount.mul(stageIdx - idx).toString(), 'Did not actually exit pool');
  }

  bpt = await pool.balanceOf(trader.address);
  console.log(`BPT balance on exit: ${bpt / 1e18}`);
}

async function showTokenBalances(label: string, address: string, poolId: string, numTokens: number) {
  const poolTokens: string[] = [];
  const poolSymbols: string[] = [];

  console.log(label);

  for (const symbol in tokens) {
    const balance = (await tokens[symbol].balanceOf(address)) / 1e18;
    console.log(`Trader has ${balance} ${symbol}`);
    poolSymbols.push(symbol);
    poolTokens.push(tokens[symbol].address);
    if (poolSymbols.length == numTokens) {
      break;
    }
  }

  const poolBalances: BigNumber[] = await vault.getPoolTokenBalances(poolId, poolTokens);

  for (let idx = 0; idx < numTokens; idx++) {
    const n: BigNumber = poolBalances[idx];

    console.log(`Pool has ${ethers.utils.formatEther(n.toString())} ${poolSymbols[idx]}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
