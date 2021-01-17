import { printGas, setupEnvironment, getWeightedPool, getStablePool } from './misc';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { MAX_UINT256 } from '../../test/helpers/constants';
import { TokenList } from '../../test/helpers/tokens';
import { BigNumber, Contract } from 'ethers';
import { assert } from 'console';
import { ethers } from 'hardhat';

// setupEnvironmnt
const BPTAmount = BigNumber.from((10e18).toString());
const numberJoinsExits = 3;

let vault: Contract;
let tokens: TokenList;

let trader: SignerWithAddress;

async function main() {
  ({ vault, tokens, trader } = await setupEnvironment());

  console.log('== Full join/exit (no initial BPT) ==');

  console.log(`\n# Constant Product Pools, full join/exit, transferring tokens\n`);

  // numTokens is the size of the pool: 2,4,6,8
  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    await joinAndExitPool(() => getWeightedPool(vault, tokens, numTokens), 'ConstantProductPool', numTokens, true);
  }

  console.log(`# Constant Product Pools, full join/exit, with user balance\n`);

  // numTokens is the size of the pool: 2,4,6,8
  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    await joinAndExitPool(() => getWeightedPool(vault, tokens, numTokens), 'ConstantProductPool', numTokens, false);
  }

  console.log(`# Stablecoin Pools, full join/exit, transferring tokens\n`);

  // numTokens is the size of the pool: 2,4,6,8
  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    await joinAndExitPool(() => getStablePool(vault, tokens, numTokens), 'StablecoinPool', numTokens, true);
  }

  console.log(`# Stablecoin Pools, full join/exit, with user balance\n`);

  // numTokens is the size of the pool: 2,4,6,8
  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    await joinAndExitPool(() => getStablePool(vault, tokens, numTokens), 'ConstantProductPool', numTokens, false);
  }

  console.log('== Partial Join/Exit (2-stage entry/exit)==');

  console.log(`\n# Constant Product Pools, partial join/exit, transferring tokens\n`);

  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    await joinAndExitPool(
      () => getWeightedPool(vault, tokens, numTokens),
      'ConstantProductPool',
      numTokens,
      true,
      numberJoinsExits
    );
  }

  console.log(`# Constant Product Pools, partial join/exit, with user balance\n`);

  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    await joinAndExitPool(
      () => getWeightedPool(vault, tokens, numTokens),
      'ConstantProductPool',
      numTokens,
      false,
      numberJoinsExits
    );
  }

  console.log(`# Stablecoin Pools, partial join/exit, transferring tokens\n`);

  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    await joinAndExitPool(
      () => getStablePool(vault, tokens, numTokens),
      'StablecoinPool',
      numTokens,
      true,
      numberJoinsExits
    );
  }

  console.log(`# Stablecoin Pools, partial join/exit, with user balance\n`);

  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    await joinAndExitPool(
      () => getStablePool(vault, tokens, numTokens),
      'StablecoinPool',
      numTokens,
      false,
      numberJoinsExits
    );
  }
}

async function joinAndExitPool(
  getPoolId: () => Promise<string>,
  poolType: string,
  numTokens: number,
  transferTokens: boolean,
  stageIdx = 1
) {
  const poolId: string = await getPoolId();
  const [poolAddress] = await vault.getPool(poolId);
  const pool: Contract = await ethers.getContractAt('WeightedPool', poolAddress);
  const transfer = transferTokens ? 'Transferring tokens' : 'With User Balance';
  let receipt;
  let bpt;

  for (let idx = 1; idx <= stageIdx; idx++) {
    receipt = await (
      await (pool as Contract)
        .connect(trader)
        .joinPool(BPTAmount, Array(numTokens).fill(MAX_UINT256), transferTokens, trader.address)
    ).wait();
    console.log(
      `${printGas(receipt.gasUsed)} gas for join ${idx} to a ${poolType} with ${numTokens} tokens (${transfer})`
    );

    bpt = await pool.balanceOf(trader.address);
    // check token balances
    assert(bpt.toString() == BPTAmount.mul(idx).toString(), 'Did not actually join pool');
  }

  // Now exit the pool
  for (let idx = 1; idx <= stageIdx; idx++) {
    receipt = await (
      await pool.connect(trader).exitPool(BPTAmount, Array(numTokens).fill(0), transferTokens, trader.address)
    ).wait();
    console.log(
      `${printGas(receipt.gasUsed)} gas for exit ${idx} of a ${poolType} with ${numTokens} tokens (${transfer})`
    );

    bpt = await pool.balanceOf(trader.address);
    assert(bpt.toString() == BPTAmount.mul(stageIdx - idx).toString(), 'Did not actually exit pool');
  }

  console.log('\n');

  bpt = await pool.balanceOf(trader.address);
  assert(bpt.toString() == '0', 'Did not actually join pool');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
