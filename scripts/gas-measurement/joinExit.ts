import { printGas, setupEnvironment, getConstantProductPool, getStablecoinPool } from './misc';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { MAX_UINT256 } from '../../test/helpers/constants';
import { TokenList } from '../../test/helpers/tokens';
import { BigNumber, Contract } from 'ethers';
import { assert } from 'console';
import { ethers } from 'hardhat';

// setupEnvironmnt
const BPTAmount = BigNumber.from((10e18).toString());

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
      'ConstantProductPool',
      numTokens,
      true
    );
  }

  console.log(`\n# Constant Product Pools, full join/exit, with user balance`);

  // numTokens is the size of the pool: 2,4,6,8
  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    await joinAndExitPool(
      () => getConstantProductPool(vault, tokens, numTokens),
      'ConstantProductPool',
      numTokens,
      false
    );
  }

  console.log(`\n# Stablecoin Pools, full join/exit, transferring tokens`);

  // numTokens is the size of the pool: 2,4,6,8
  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    await joinAndExitPool(() => getStablecoinPool(vault, tokens, numTokens), 'StablecoinPool', numTokens, true);
  }

  console.log(`\n# Stablecoin Pools, full join/exit, with user balance`);

  // numTokens is the size of the pool: 2,4,6,8
  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    await joinAndExitPool(() => getStablecoinPool(vault, tokens, numTokens), 'ConstantProductPool', numTokens, false);
  }

  console.log('== Partial Join/Exit (2-stage entry/exit)==');

  console.log(`\n# Constant Product Pools, partial join/exit, transferring tokens`);

  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    await joinAndExitPool(
      () => getConstantProductPool(vault, tokens, numTokens),
      'ConstantProductPool',
      numTokens,
      true,
      2
    );
  }

  console.log(`\n# Constant Product Pools, partial join/exit, with user balance`);

  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    await joinAndExitPool(
      () => getConstantProductPool(vault, tokens, numTokens),
      'ConstantProductPool',
      numTokens,
      false,
      2
    );
  }

  console.log(`\n# Stablecoin Pools, partial join/exit, transferring tokens`);

  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    await joinAndExitPool(() => getStablecoinPool(vault, tokens, numTokens), 'StablecoinPool', numTokens, true, 2);
  }

  console.log(`\n# Stablecoin Pools, partial join/exit, with user balance`);

  for (let numTokens = 2; numTokens <= 8; numTokens += 2) {
    await joinAndExitPool(() => getStablecoinPool(vault, tokens, numTokens), 'StablecoinPool', numTokens, false, 2);
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
  const [poolAddress] = await vault.fromPoolId(poolId);
  const pool: Contract = await ethers.getContractAt('ConstantProductPool', poolAddress);
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
    if (idx > 1) {
      console.log('TODO: Need to fix; full exit reverts!');
      break;
    }

    receipt = await (
      await pool.connect(trader).exitPool(BPTAmount, Array(numTokens).fill(0), transferTokens, trader.address)
    ).wait();
    console.log(
      `${printGas(receipt.gasUsed)} gas for exit ${idx} of a ${poolType} with ${numTokens} tokens (${transfer})`
    );

    bpt = await pool.balanceOf(trader.address);
    assert(bpt.toString() == BPTAmount.mul(stageIdx - idx).toString(), 'Did not actually exit pool');
  }

  bpt = await pool.balanceOf(trader.address);
  console.log(`BPT balance on exit: ${bpt.div((1e18).toString())}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
