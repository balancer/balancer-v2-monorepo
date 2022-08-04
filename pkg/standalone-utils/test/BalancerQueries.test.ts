import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { MAX_UINT112, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { SwapKind, WeightedPoolEncoder } from '@balancer-labs/balancer-js';

import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';

describe('BalancerQueries', function () {
  let queries: Contract, vault: Vault, pool: WeightedPool, tokens: TokenList, lp: SignerWithAddress;

  const initialBalances = [fp(20), fp(30)];

  const sender = ZERO_ADDRESS;
  const recipient = ZERO_ADDRESS;

  before('setup signers', async () => {
    [, lp] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy and initialize pool', async () => {
    tokens = await TokenList.create(2, { sorted: true });
    pool = await WeightedPool.create({ tokens, swapFeePercentage: fp(0.000001), fromFactory: true });
    vault = pool.vault;

    await tokens.mint({ to: lp, amount: fp(100) });
    await tokens.approve({ from: lp, to: vault.address, amount: fp(100) });
    await pool.init({ initialBalances, from: lp });
  });

  sharedBeforeEach('deploy queries', async () => {
    queries = await deploy('BalancerQueries', { args: [pool.vault.address] });
  });

  describe('querySwap', () => {
    // These two values are superfluous, as they are not used by the query
    const fromInternalBalance = false;
    const toInternalBalance = false;

    it('can query swap results', async () => {
      const amount = fp(1);
      const indexIn = 0;
      const indexOut = 1;

      const expectedAmountOut = await pool.estimateGivenIn({ in: indexIn, out: indexOut, amount });

      const result = await queries.querySwap(
        {
          poolId: pool.poolId,
          kind: SwapKind.GivenIn,
          assetIn: tokens.get(indexIn).address,
          assetOut: tokens.get(indexOut).address,
          amount,
          userData: '0x',
        },
        { sender, recipient, fromInternalBalance, toInternalBalance }
      );

      expect(result).to.be.equalWithError(expectedAmountOut, 0.0001);
    });

    it('bubbles up revert reasons', async () => {
      const tx = queries.querySwap(
        {
          poolId: pool.poolId,
          kind: SwapKind.GivenIn,
          assetIn: tokens.get(0).address,
          assetOut: tokens.get(1).address,
          amount: initialBalances[0],
          userData: '0x',
        },
        { sender, recipient, fromInternalBalance, toInternalBalance }
      );

      await expect(tx).to.be.revertedWith('MAX_IN_RATIO');
    });
  });

  describe('queryBatchSwap', () => {
    // These two values are superfluous, as they are not used by the query
    const fromInternalBalance = false;
    const toInternalBalance = false;

    it('can query batch swap results', async () => {
      const amount = fp(1);
      const indexIn = 0;
      const indexOut = 1;

      const expectedAmountOut = await pool.estimateGivenIn({ in: indexIn, out: indexOut, amount });

      const result = await queries.queryBatchSwap(
        SwapKind.GivenIn,
        [{ poolId: pool.poolId, assetInIndex: indexIn, assetOutIndex: indexOut, amount, userData: '0x' }],
        tokens.addresses,
        { sender, recipient, fromInternalBalance, toInternalBalance }
      );

      expect(result[indexIn]).to.deep.equal(amount);
      expect(result[indexOut].mul(-1)).to.be.equalWithError(expectedAmountOut, 0.0001);
    });

    it('bubbles up revert reasons', async () => {
      const tx = queries.queryBatchSwap(
        SwapKind.GivenIn,
        [{ poolId: pool.poolId, assetInIndex: 0, assetOutIndex: 1, amount: initialBalances[0], userData: '0x' }],
        tokens.addresses,
        { sender, recipient, fromInternalBalance, toInternalBalance }
      );

      await expect(tx).to.be.revertedWith('MAX_IN_RATIO');
    });
  });

  describe('queryJoin', () => {
    // These two values are superfluous, as they are not used by the helper
    const fromInternalBalance = false;
    const maxAmountsIn: BigNumber[] = [MAX_UINT112, MAX_UINT112];

    it('can query join results', async () => {
      const amountsIn = [fp(1), fp(0)];
      const expectedBptOut = await pool.estimateBptOut(amountsIn);

      const data = WeightedPoolEncoder.joinExactTokensInForBPTOut(amountsIn, 0);
      const result = await queries.queryJoin(pool.poolId, sender, recipient, {
        assets: tokens.addresses,
        maxAmountsIn,
        fromInternalBalance: false,
        userData: data,
      });

      expect(result.amountsIn).to.deep.equal(amountsIn);
      expect(result.bptOut).to.be.equalWithError(expectedBptOut, 0.0001);
    });

    it('bubbles up revert reasons', async () => {
      const data = WeightedPoolEncoder.joinInit(initialBalances);
      const tx = queries.queryJoin(pool.poolId, sender, recipient, {
        assets: tokens.addresses,
        maxAmountsIn: maxAmountsIn,
        fromInternalBalance: fromInternalBalance,
        userData: data,
      });

      await expect(tx).to.be.revertedWith('UNHANDLED_JOIN_KIND');
    });
  });

  describe('queryExit', () => {
    let bptIn: BigNumber, expectedAmountsOut: BigNumber[], data: string;

    // This value is superfluous, as it is not used by the helper
    const minAmountsOut: BigNumber[] = [];

    sharedBeforeEach('estimate expected amounts out', async () => {
      bptIn = (await pool.totalSupply()).div(2);
      expectedAmountsOut = initialBalances.map((balance) => balance.div(2));
      data = WeightedPoolEncoder.exitExactBPTInForTokensOut(bptIn);
    });

    it('can query exit results', async () => {
      const result = await queries.queryExit(pool.poolId, sender, recipient, {
        assets: tokens.addresses,
        minAmountsOut,
        toInternalBalance: false,
        userData: data,
      });

      expect(result.bptIn).to.equal(bptIn);
      expect(result.amountsOut).to.be.lteWithError(expectedAmountsOut, 0.00001);
    });

    it('bubbles up revert reasons', async () => {
      const tooBigIndex = 90;
      const data = WeightedPoolEncoder.exitExactBPTInForOneTokenOut(bptIn, tooBigIndex);
      const tx = queries.queryExit(pool.poolId, sender, recipient, {
        assets: tokens.addresses,
        minAmountsOut,
        toInternalBalance: false,
        userData: data,
      });

      await expect(tx).to.be.revertedWith('OUT_OF_BOUNDS');
    });
  });
});
