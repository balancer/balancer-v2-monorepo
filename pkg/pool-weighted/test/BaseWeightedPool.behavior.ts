import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { PoolSpecialization, SwapKind } from '@balancer-labs/balancer-js';
import { BigNumberish, bn, fp, FP_SCALING_FACTOR, pct } from "@balancer-labs/v2-helpers/src/numbers";
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { RawWeightedPoolDeployment, WeightedPoolType } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';

export function itBehavesAsWeightedPool(
  numberOfTokens: number,
  poolType: WeightedPoolType = WeightedPoolType.WEIGHTED_POOL
): void {
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const WEIGHTS = [fp(30), fp(70), fp(5), fp(5)];
  const INITIAL_BALANCES = [fp(1), fp(4), fp(2.7), fp(3.6)];

  let recipient: SignerWithAddress, other: SignerWithAddress, lp: SignerWithAddress, assetManager: SignerWithAddress;

  let pool: WeightedPool, allTokens: TokenList, tokens: TokenList;

  const ZEROS = Array(numberOfTokens).fill(bn(0));
  const weights: BigNumberish[] = WEIGHTS.slice(0, numberOfTokens);
  const initialBalances = INITIAL_BALANCES.slice(0, numberOfTokens);

  async function deployPool(params: RawWeightedPoolDeployment = {}): Promise<void> {
    const assetManagers = Array(numberOfTokens).fill(assetManager.address);

    params = Object.assign(
      {},
      { tokens, weights, assetManagers, swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE, poolType },
      params
    );
    pool = await WeightedPool.create(params);
  }

  before('setup signers', async () => {
    [, lp, recipient, other, assetManager] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy tokens', async () => {
    allTokens = await TokenList.create(
      [
        {
          symbol: 'MKR',
          decimals: 0,
        },
        {
          symbol: 'DAI',
          decimals: 0,
        },
      ],
      { sorted: true }
    );
    await allTokens.mint({ to: lp, amount: fp(100) });
  });

  beforeEach('define pool tokens', () => {
    tokens = allTokens.subset(numberOfTokens);
  });

  describe('onSwap', () => {
    sharedBeforeEach('deploy and join pool', async () => {
      await deployPool();
      await pool.init({ initialBalances });
    });

    context('given in', () => {
      it('reverts if caller is not the vault', async () => {
        await expect(
          pool.instance.onSwap(
            {
              kind: SwapKind.GivenIn,
              tokenIn: tokens.first.address,
              tokenOut: tokens.second.address,
              amount: 0,
              poolId: await pool.getPoolId(),
              lastChangeBlock: 0,
              from: other.address,
              to: other.address,
              userData: '0x',
            },
            0,
            0
          )
        ).to.be.revertedWith('CALLER_NOT_VAULT');
      });

      it('calculates amount out', async () => {
        const amount = fp(0.1);
        const amountWithFees = amount.mul(POOL_SWAP_FEE_PERCENTAGE.add(fp(1))).div(fp(1));
        const expectedAmountOut = await pool.estimateGivenIn({ in: 1, out: 0, amount: amountWithFees });

        const result = await pool.swapGivenIn({ in: 1, out: 0, amount: amountWithFees });

        expect(result.amount).to.be.equalWithError(expectedAmountOut, 0.01);
      });

      it('calculates max amount out', async () => {
        const maxAmountIn = await pool.getMaxIn(1);
        const maxAmountInWithFees = maxAmountIn.mul(POOL_SWAP_FEE_PERCENTAGE.add(fp(1))).div(fp(1));
        const expectedAmountOut = await pool.estimateGivenIn({ in: 1, out: 0, amount: maxAmountInWithFees });

        const result = await pool.swapGivenIn({ in: 1, out: 0, amount: maxAmountInWithFees });

        expect(result.amount).to.be.equalWithError(expectedAmountOut, 0.05);
      });

      it.only('reverts if token in exceeds max in ratio', async () => {
        const maxAmountIn = await pool.getMaxIn(1);
        const maxAmountInWithFees = maxAmountIn.mul(POOL_SWAP_FEE_PERCENTAGE.add(fp(1))).div(fp(1));
        console.log('maxAmountInWithFees', maxAmountInWithFees.div(FP_SCALING_FACTOR).toString());
        const amount = maxAmountInWithFees.add(fp(1));
        await expect(pool.swapGivenIn({ in: 1, out: 0, amount })).to.be.revertedWith('MAX_IN_RATIO');
      });

      if (poolType != WeightedPoolType.ORACLE_WEIGHTED_POOL) {
        it('reverts if token in is not in the pool', async () => {
          await expect(pool.swapGivenIn({ in: allTokens.BAT, out: 0, amount: 1 })).to.be.revertedWith('INVALID_TOKEN');
        });

        it('reverts if token out is not in the pool', async () => {
          await expect(pool.swapGivenIn({ in: 1, out: allTokens.BAT, amount: 1 })).to.be.revertedWith('INVALID_TOKEN');
        });
      }

      it('reverts if paused', async () => {
        await pool.pause();

        await expect(pool.swapGivenIn({ in: 1, out: 0, amount: 1 })).to.be.revertedWith('PAUSED');
      });
    });

    context('given out', () => {
      it('reverts if caller is not the vault', async () => {
        await expect(
          pool.instance.onSwap(
            {
              kind: SwapKind.GivenOut,
              tokenIn: tokens.first.address,
              tokenOut: tokens.second.address,
              amount: 0,
              poolId: await pool.getPoolId(),
              lastChangeBlock: 0,
              from: other.address,
              to: other.address,
              userData: '0x',
            },
            0,
            0
          )
        ).to.be.revertedWith('CALLER_NOT_VAULT');
      });

      it('calculates amount in', async () => {
        const amount = fp(0.1);
        const expectedAmountIn = await pool.estimateGivenOut({ in: 1, out: 0, amount });

        const result = await pool.swapGivenOut({ in: 1, out: 0, amount });

        expect(result.amount).to.be.equalWithError(expectedAmountIn, 0.1);
      });

      it('calculates max amount in', async () => {
        const amount = await pool.getMaxOut(0);
        const expectedAmountIn = await pool.estimateGivenOut({ in: 1, out: 0, amount });

        const result = await pool.swapGivenOut({ in: 1, out: 0, amount });

        expect(result.amount).to.be.equalWithError(expectedAmountIn, 0.1);
      });

      it('reverts if token in exceeds max out ratio', async () => {
        const amount = (await pool.getMaxOut(0)).add(2);

        await expect(pool.swapGivenOut({ in: 1, out: 0, amount })).to.be.revertedWith('MAX_OUT_RATIO');
      });

      if (poolType != WeightedPoolType.ORACLE_WEIGHTED_POOL) {
        it('reverts if token in is not in the pool when given out', async () => {
          await expect(pool.swapGivenOut({ in: allTokens.BAT, out: 0, amount: 1 })).to.be.revertedWith('INVALID_TOKEN');
        });

        it('reverts if token out is not in the pool', async () => {
          await expect(pool.swapGivenOut({ in: 1, out: allTokens.BAT, amount: 1 })).to.be.revertedWith('INVALID_TOKEN');
        });
      }

      it('reverts if paused', async () => {
        await pool.pause();

        await expect(pool.swapGivenOut({ in: 1, out: 0, amount: 1 })).to.be.revertedWith('PAUSED');
      });
    });
  });
}
