import { assert } from 'console';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { bn, printGas } from '@balancer-labs/v2-helpers/src/numbers';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { setupEnvironment, getWeightedPool, getStablePool, pickTokenAddresses } from './misc';
import { WeightedPoolEncoder, StablePoolEncoder } from '@balancer-labs/balancer-js';
import { deployedAt } from '@balancer-labs/v2-helpers/src/contract';

// setup environment
const BPTAmount = bn(1e18);
const numberJoinsExits = 3;
const managedPoolMin = 15;
const managedPoolMax = 35;
const maxManagedTokens = 38;
const managedPoolStep = 5;

let vault: Vault;
let tokens: TokenList;

let trader: SignerWithAddress;

const printTokens = (poolType: string, numTokens: number) => {
  console.log(`${poolType} with ${numTokens} tokens`);
};

async function main() {
  ({ vault, tokens, trader } = await setupEnvironment());

  console.log('== Full join/exit (no initial BPT) ==');

  console.log(`\n#Transferring tokens\n`);

  const joinWeightedUserData = WeightedPoolEncoder.joinTokenInForExactBPTOut(BPTAmount, 0);
  const exitWeightedUserData = WeightedPoolEncoder.exitExactBPTInForTokensOut(BPTAmount);

  // numTokens is the size of the pool: 2,4,6,8,...
  for (let numTokens = 2; numTokens <= 20; numTokens += 2) {
    printTokens('Weighted pool', numTokens);
    await joinAndExitWeightedPool(
      () => getWeightedPool(vault, tokens, numTokens, 0),
      numTokens,
      true,
      joinWeightedUserData,
      exitWeightedUserData
    );
  }
  console.log('\n');

  for (let numTokens = managedPoolMin; numTokens <= managedPoolMax; numTokens += managedPoolStep) {
    printTokens('Managed pool', numTokens);
    await joinAndExitWeightedPool(
      () => getWeightedPool(vault, tokens, numTokens),
      numTokens,
      true,
      joinWeightedUserData,
      exitWeightedUserData
    );
  }
  console.log('\n');

  printTokens('Managed pool', maxManagedTokens);
  await joinAndExitWeightedPool(
    () => getWeightedPool(vault, tokens, maxManagedTokens),
    maxManagedTokens,
    true,
    joinWeightedUserData,
    exitWeightedUserData
  );
  console.log('\n');

  // numTokens is the size of the pool: 2,4
  // Stable have a max of 5
  for (let numTokens = 2; numTokens <= 4; numTokens += 2) {
    printTokens('Stable pool', numTokens);
    await joinAndExitStablePool(() => getStablePool(vault, tokens, numTokens), true);
  }
  console.log('\n');

  console.log(`#With user balance\n`);

  // numTokens is the size of the pool: 2,4,6,8,...
  for (let numTokens = 2; numTokens <= 20; numTokens += 2) {
    printTokens('Weighted pool', numTokens);
    await joinAndExitWeightedPool(
      () => getWeightedPool(vault, tokens, numTokens, 0),
      numTokens,
      false,
      joinWeightedUserData,
      exitWeightedUserData
    );
  }
  console.log('\n');

  for (let numTokens = managedPoolMin; numTokens <= managedPoolMax; numTokens += managedPoolStep) {
    printTokens('Managed pool', numTokens);
    await joinAndExitWeightedPool(
      () => getWeightedPool(vault, tokens, numTokens),
      numTokens,
      false,
      joinWeightedUserData,
      exitWeightedUserData
    );
  }
  console.log('\n');

  printTokens('Managed pool', maxManagedTokens);
  await joinAndExitWeightedPool(
    () => getWeightedPool(vault, tokens, maxManagedTokens),
    maxManagedTokens,
    false,
    joinWeightedUserData,
    exitWeightedUserData
  );
  console.log('\n');

  // numTokens is the size of the pool: 2,4
  // Stable have a max of 5
  for (let numTokens = 2; numTokens <= 4; numTokens += 2) {
    printTokens('Stable pool', numTokens);
    await joinAndExitStablePool(() => getStablePool(vault, tokens, numTokens), false);
  }
  console.log('\n');

  console.log('== Partial Join/Exit (2-stage entry/exit) ==');

  console.log(`\n#Transferring tokens\n`);

  for (let numTokens = 2; numTokens <= 20; numTokens += 2) {
    printTokens('Weighted pool', numTokens);
    await joinAndExitWeightedPool(
      () => getWeightedPool(vault, tokens, numTokens, 0),
      numTokens,
      true,
      joinWeightedUserData,
      exitWeightedUserData,
      numberJoinsExits
    );
  }
  console.log('\n');

  for (let numTokens = managedPoolMin; numTokens <= managedPoolMax; numTokens += managedPoolStep) {
    printTokens('Managed pool', numTokens);
    await joinAndExitWeightedPool(
      () => getWeightedPool(vault, tokens, numTokens),
      numTokens,
      true,
      joinWeightedUserData,
      exitWeightedUserData,
      numberJoinsExits
    );
  }
  console.log('\n');

  printTokens('Managed pool', maxManagedTokens);
  await joinAndExitWeightedPool(
    () => getWeightedPool(vault, tokens, maxManagedTokens),
    maxManagedTokens,
    true,
    joinWeightedUserData,
    exitWeightedUserData,
    numberJoinsExits
  );
  console.log('\n');

  for (let numTokens = 2; numTokens <= 4; numTokens += 2) {
    printTokens('Stable pool', numTokens);
    await joinAndExitStablePool(() => getStablePool(vault, tokens, numTokens), true, numberJoinsExits);
  }
  console.log('\n');

  console.log(`#With user balance\n`);

  for (let numTokens = 2; numTokens <= 20; numTokens += 2) {
    printTokens('Weighted pool', numTokens);
    await joinAndExitWeightedPool(
      () => getWeightedPool(vault, tokens, numTokens, 0),
      numTokens,
      false,
      joinWeightedUserData,
      exitWeightedUserData,
      numberJoinsExits
    );
  }
  console.log('\n');

  for (let numTokens = managedPoolMin; numTokens <= managedPoolMax; numTokens += managedPoolStep) {
    printTokens('Managed pool', numTokens);
    await joinAndExitWeightedPool(
      () => getWeightedPool(vault, tokens, numTokens),
      numTokens,
      false,
      joinWeightedUserData,
      exitWeightedUserData,
      numberJoinsExits
    );
  }
  console.log('\n');

  printTokens('Managed pool', maxManagedTokens);
  await joinAndExitWeightedPool(
    () => getWeightedPool(vault, tokens, maxManagedTokens),
    maxManagedTokens,
    false,
    joinWeightedUserData,
    exitWeightedUserData,
    numberJoinsExits
  );
  console.log('\n');

  for (let numTokens = 2; numTokens <= 4; numTokens += 2) {
    printTokens('Stable pool', numTokens);
    await joinAndExitStablePool(() => getStablePool(vault, tokens, numTokens), false, numberJoinsExits);
  }
}

async function joinAndExitWeightedPool(
  getPoolId: () => Promise<string>,
  numTokens: number,
  transferTokens: boolean,
  joinData: unknown,
  exitData: unknown,
  stageIdx = 1
) {
  const poolId: string = await getPoolId();

  const { address: poolAddress } = await vault.getPool(poolId);
  const pool: Contract = await deployedAt('v2-pool-weighted/WeightedPool', poolAddress);

  const joinRequest = {
    assets: pickTokenAddresses(tokens, numTokens),
    maxAmountsIn: Array(numTokens).fill(MAX_UINT256),
    userData: joinData,
    fromInternalBalance: !transferTokens,
  };
  const exitRequest = {
    assets: pickTokenAddresses(tokens, numTokens),
    minAmountsOut: Array(numTokens).fill(0),
    userData: exitData,
    fromInternalBalance: !transferTokens,
  };

  await joinAndExitInternal(poolId, pool, stageIdx, joinRequest, exitRequest);
}

async function joinAndExitStablePool(getPoolId: () => Promise<string>, transferTokens: boolean, stageIdx = 1) {
  const poolId: string = await getPoolId();

  const { address: poolAddress } = await vault.getPool(poolId);
  const pool: Contract = await deployedAt('v2-pool-stable-phantom/StablePhantomPool', poolAddress);

  const { tokens: allTokens } = await vault.getPoolTokens(poolId);

  const bptIndex = allTokens.indexOf(pool.address);
  const tokenIndex = bptIndex == 0 ? 1 : 0;

  const joinData = StablePoolEncoder.joinTokenInForExactBPTOut(BPTAmount, tokenIndex);
  const exitData = StablePoolEncoder.exitExactBPTInForOneTokenOut(BPTAmount, tokenIndex);

  const joinRequest = {
    assets: allTokens,
    maxAmountsIn: Array(allTokens.length).fill(MAX_UINT256),
    userData: joinData,
    fromInternalBalance: !transferTokens,
  };
  const exitRequest = {
    assets: allTokens,
    minAmountsOut: Array(allTokens.length).fill(0),
    userData: exitData,
    fromInternalBalance: !transferTokens,
  };

  await joinAndExitInternal(poolId, pool, stageIdx, joinRequest, exitRequest);
}

async function joinAndExitInternal(
  poolId: string,
  pool: Contract,
  stageIdx: number,
  joinRequest: unknown,
  exitRequest: unknown
) {
  let receipt;
  let bpt;

  for (let idx = 1; idx <= stageIdx; idx++) {
    receipt = await (
      await vault.instance.connect(trader).joinPool(poolId, trader.address, trader.address, joinRequest)
    ).wait();
    console.log(`${printGas(receipt.gasUsed)} gas for join ${idx}`);

    bpt = await pool.balanceOf(trader.address);

    // check token balances
    assert(bpt.toString() == BPTAmount.mul(idx).toString(), 'Did not actually join pool');
  }

  // Now exit the pool
  for (let idx = 1; idx <= stageIdx; idx++) {
    receipt = await (
      await vault.instance.connect(trader).exitPool(poolId, trader.address, trader.address, exitRequest)
    ).wait();
    console.log(`${printGas(receipt.gasUsed)} gas for exit ${idx}`);

    bpt = await pool.balanceOf(trader.address);
    assert(bpt.toString() == BPTAmount.mul(stageIdx - idx).toString(), 'Did not actually exit pool');
  }

  bpt = await pool.balanceOf(trader.address);
  assert(bpt.toString() == '0', 'Did not actually exit pool');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
