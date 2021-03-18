import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { encodeJoin } from '../helpers/mockPool';

import { fp, bn } from '../../lib/helpers/numbers';
import { deploy } from '../../lib/helpers/deploy';
import { MinimalSwapInfoPool } from '../../lib/helpers/pools';
import { FundManagement, Swap } from '../../lib/helpers/trading';
import { MAX_UINT112, MAX_UINT256, ZERO_ADDRESS } from '../../lib/helpers/constants';
import TokenList from '../helpers/models/tokens/TokenList';

describe('Vault - swap queries', () => {
  let vault: Contract, funds: FundManagement;
  let tokens: TokenList;
  let lp: SignerWithAddress;
  const poolIds: string[] = [];

  const MAX_POOLS = 2;

  const SWAP_KIND = {
    GIVEN_IN: 0,
    GIVEN_OUT: 1,
  };

  before('setup', async () => {
    [, lp] = await ethers.getSigners();

    // All of the tests in this suite have no side effects, so we deploy and initially contracts only one to save time
    vault = await deploy('Vault', { args: [ZERO_ADDRESS, ZERO_ADDRESS, 0, 0] });

    tokens = await TokenList.create(['DAI', 'MKR', 'SNX'], { sorted: true });
    await tokens.mint({ to: lp, amount: MAX_UINT112.div(2) });
    await tokens.approve({ to: vault, amount: MAX_UINT112, from: lp });

    for (let i = 0; i < MAX_POOLS; ++i) {
      const pool = await deploy('MockPool', { args: [vault.address, MinimalSwapInfoPool] });
      const poolId = await pool.getPoolId();

      await pool.setMultiplier(fp(2));
      await pool.registerTokens(tokens.addresses, Array(tokens.length).fill(ZERO_ADDRESS));

      await vault
        .connect(lp)
        .joinPool(
          poolId,
          lp.address,
          lp.address,
          tokens.addresses,
          Array(tokens.length).fill(MAX_UINT256),
          false,
          encodeJoin(Array(tokens.length).fill(bn(100e18)), Array(tokens.length).fill(0))
        );

      poolIds.push(poolId);
    }

    funds = {
      sender: vault.address,
      recipient: ZERO_ADDRESS,
      fromInternalBalance: false,
      toInternalBalance: false,
    };
  });

  type SwapData = {
    poolIdIndex: number;
    tokenInIndex: number;
    tokenOutIndex: number;
    amount: number;
  };

  function toSwaps(swapsData: SwapData[]): Swap[] {
    return swapsData.map((swapData) => {
      return {
        poolId: poolIds[swapData.poolIdIndex],
        tokenInIndex: swapData.tokenInIndex,
        tokenOutIndex: swapData.tokenOutIndex,
        amount: swapData.amount,
        userData: '0x',
      };
    });
  }

  describe('given in', () => {
    function assertQueryBatchSwapGivenIn(swapsData: SwapData[], expectedDeltas: number[]) {
      it('returns the expected amounts', async () => {
        const swaps: Swap[] = toSwaps(swapsData);
        const deltas = await vault.callStatic.queryBatchSwap(SWAP_KIND.GIVEN_IN, swaps, tokens.addresses, funds);
        expect(deltas).to.deep.equal(expectedDeltas.map(bn));
      });
    }

    describe('single swap', () => {
      assertQueryBatchSwapGivenIn(
        [
          {
            poolIdIndex: 0,
            tokenInIndex: 0,
            tokenOutIndex: 1,
            amount: 5,
          },
        ],
        [5, -10, 0]
      );
    });

    describe('multiple pools', () => {
      assertQueryBatchSwapGivenIn(
        [
          {
            poolIdIndex: 0,
            tokenInIndex: 0,
            tokenOutIndex: 1,
            amount: 5,
          },
          {
            poolIdIndex: 1,
            tokenInIndex: 0,
            tokenOutIndex: 1,
            amount: 5,
          },
        ],
        [10, -20, 0]
      );
    });

    describe('multihop', () => {
      assertQueryBatchSwapGivenIn(
        [
          {
            poolIdIndex: 0,
            tokenInIndex: 0,
            tokenOutIndex: 1,
            amount: 5,
          },
          {
            poolIdIndex: 1,
            tokenInIndex: 1,
            tokenOutIndex: 2,
            amount: 0,
          },
        ],
        [5, 0, -20]
      );
    });

    describe('error', () => {
      it('bubbles up revert reasons', async () => {
        const invalidSwap: Swap[] = toSwaps([{ poolIdIndex: 0, tokenInIndex: 100, tokenOutIndex: 1, amount: 5 }]);
        const tx = vault.callStatic.queryBatchSwap(SWAP_KIND.GIVEN_IN, invalidSwap, tokens.addresses, funds);
        await expect(tx).to.be.revertedWith('OUT_OF_BOUNDS');
      });
    });
  });

  describe('given out', () => {
    function assertQueryBatchSwapGivenOut(swapsData: SwapData[], expectedDeltas: number[]) {
      it('returns the expected amounts', async () => {
        const swaps: Swap[] = toSwaps(swapsData);

        const deltas = await vault.callStatic.queryBatchSwap(SWAP_KIND.GIVEN_OUT, swaps, tokens.addresses, funds);
        expect(deltas).to.deep.equal(expectedDeltas.map(bn));
      });
    }

    describe('single swap', () => {
      assertQueryBatchSwapGivenOut(
        [
          {
            poolIdIndex: 0,
            tokenInIndex: 0,
            tokenOutIndex: 1,
            amount: 10,
          },
        ],
        [5, -10, 0]
      );
    });

    describe('multiple pools', () => {
      assertQueryBatchSwapGivenOut(
        [
          {
            poolIdIndex: 0,
            tokenInIndex: 0,
            tokenOutIndex: 1,
            amount: 10,
          },
          {
            poolIdIndex: 1,
            tokenInIndex: 0,
            tokenOutIndex: 1,
            amount: 10,
          },
        ],
        [10, -20, 0]
      );
    });

    describe('multihop', () => {
      assertQueryBatchSwapGivenOut(
        [
          {
            poolIdIndex: 0,
            tokenInIndex: 0,
            tokenOutIndex: 1,
            amount: 20,
          },
          {
            poolIdIndex: 1,
            tokenInIndex: 2,
            tokenOutIndex: 0,
            amount: 0,
          },
        ],
        [0, -20, 5]
      );
    });

    describe('error', () => {
      it('bubbles up revert reasons', async () => {
        const invalidSwap: Swap[] = toSwaps([{ poolIdIndex: 0, tokenInIndex: 100, tokenOutIndex: 1, amount: 5 }]);
        const tx = vault.callStatic.queryBatchSwap(SWAP_KIND.GIVEN_OUT, invalidSwap, tokens.addresses, funds);
        await expect(tx).to.be.revertedWith('OUT_OF_BOUNDS');
      });
    });
  });
});
