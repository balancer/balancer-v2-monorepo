import { assert } from 'console';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { TokenList } from '../../helpers/tokens';
import { MAX_UINT256 } from '../../helpers/constants';
import { printGas, setupEnvironment, getWeightedPool, getStablePool } from './misc';

// setup environment
const BPTAmount = BigNumber.from((10e18).toString());
const numberJoinsExits = 3;

let vault: Contract;
let tokens: TokenList;

let trader: SignerWithAddress;

const printTokens = (poolType: string, numTokens: number) => {
  if (numTokens % 2 == 0) {
    console.log(`${poolType} with ${numTokens} tokens`);
  }
};

async function main() {
  ({ vault, tokens, trader } = await setupEnvironment());

  console.log('== Full join/exit (no initial BPT) ==');

  console.log(`\n#Transferring tokens\n`);

  // numTokens is the size of the pool: 2,4,6,8
  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    printTokens('Weighted pool', numTokens);
    await joinAndExitPool(() => getWeightedPool(vault, tokens, numTokens), numTokens, true);
  }
  console.log('\n');

  // numTokens is the size of the pool: 2,4,6,8
  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    printTokens('Stable pool', numTokens);
    await joinAndExitPool(() => getStablePool(vault, tokens, numTokens), numTokens, true);
  }
  console.log('\n');

  console.log(`#With user balance\n`);

  // numTokens is the size of the pool: 2,4,6,8
  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    printTokens('Weighted pool', numTokens);
    await joinAndExitPool(() => getWeightedPool(vault, tokens, numTokens), numTokens, false);
  }
  console.log('\n');

  // numTokens is the size of the pool: 2,4,6,8
  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    printTokens('Stable pool', numTokens);
    await joinAndExitPool(() => getStablePool(vault, tokens, numTokens), numTokens, false);
  }
  console.log('\n');

  console.log('== Partial Join/Exit (2-stage entry/exit) ==');

  console.log(`\n#Transferring tokens\n`);

  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    printTokens('Weighted pool', numTokens);
    await joinAndExitPool(() => getWeightedPool(vault, tokens, numTokens), numTokens, true, numberJoinsExits);
  }
  console.log('\n');

  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    printTokens('Stable pool', numTokens);
    await joinAndExitPool(() => getStablePool(vault, tokens, numTokens), numTokens, true, numberJoinsExits);
  }
  console.log('\n');

  console.log(`#With user balance\n`);

  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    printTokens('Weighted pool', numTokens);
    await joinAndExitPool(() => getWeightedPool(vault, tokens, numTokens), numTokens, false, numberJoinsExits);
  }
  console.log('\n');

  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    printTokens('Stable pool', numTokens);
    await joinAndExitPool(() => getStablePool(vault, tokens, numTokens), numTokens, false, numberJoinsExits);
  }
}

async function joinAndExitPool(
  getPoolId: () => Promise<string>,
  numTokens: number,
  transferTokens: boolean,
  stageIdx = 1
) {
  const poolId: string = await getPoolId();
  const [poolAddress] = await vault.getPool(poolId);
  const pool: Contract = await ethers.getContractAt('WeightedPool', poolAddress);
  let receipt;
  let bpt;

  for (let idx = 1; idx <= stageIdx; idx++) {
    receipt = await (
      await (pool as Contract)
        .connect(trader)
        .joinPool(BPTAmount, Array(numTokens).fill(MAX_UINT256), transferTokens, trader.address)
    ).wait();
    console.log(`${printGas(receipt.gasUsed)} gas for join ${idx}`);

    bpt = await pool.balanceOf(trader.address);
    // check token balances
    assert(bpt.toString() == BPTAmount.mul(idx).toString(), 'Did not actually join pool');
  }

  // Now exit the pool
  for (let idx = 1; idx <= stageIdx; idx++) {
    receipt = await (
      await pool.connect(trader).exitPool(BPTAmount, Array(numTokens).fill(0), transferTokens, trader.address)
    ).wait();
    console.log(`${printGas(receipt.gasUsed)} gas for exit ${idx}`);

    bpt = await pool.balanceOf(trader.address);
    assert(bpt.toString() == BPTAmount.mul(stageIdx - idx).toString(), 'Did not actually exit pool');
  }

  bpt = await pool.balanceOf(trader.address);
  assert(bpt.toString() == '0', 'Did not actually join pool');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
