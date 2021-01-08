import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '../../scripts/helpers/deploy';
import { toFixedPoint } from '../../scripts/helpers/fixedPoint';
import { SimplifiedQuotePool } from '../../scripts/helpers/pools';
import { FundManagement, Swap, SwapIn, SwapOut, toSwapIn, toSwapOut } from '../../scripts/helpers/trading';

import { deployTokens, TokenList } from '../helpers/tokens';
import { MAX_UINT128, ZERO_ADDRESS } from '../helpers/constants';

describe('Vault - swap queries', () => {
  let vault: Contract, funds: FundManagement;
  let tokens: TokenList, tokenAddresses: string[];
  let lp: SignerWithAddress;
  const poolIds: string[] = [];

  const MAX_POOLS = 2;

  before('setup', async () => {
    [, lp] = await ethers.getSigners();

    // All of the tests in this suite have no side effects, so we deploy and initially contracts only one to save time

    vault = await deploy('Vault', { args: [ZERO_ADDRESS] });
    tokens = await deployTokens(['DAI', 'MKR', 'SNX'], [18, 18, 18]);
    tokenAddresses = [tokens.DAI.address, tokens.MKR.address, tokens.SNX.address];

    for (const symbol in tokens) {
      await tokens[symbol].mint(lp.address, MAX_UINT128.div(2));
      await tokens[symbol].connect(lp).approve(vault.address, MAX_UINT128);
    }

    for (let i = 0; i < MAX_POOLS; ++i) {
      const pool = await deploy('MockPool', { args: [vault.address, SimplifiedQuotePool] });
      await pool.setMultiplier(toFixedPoint(2));

      await vault.connect(lp).addUserAgent(pool.address);

      await pool.connect(lp).registerTokens(tokenAddresses);

      await pool.connect(lp).addLiquidity(
        tokenAddresses,
        tokenAddresses.map(() => (100e18).toString())
      );

      poolIds.push(await pool.getPoolId());
    }

    funds = {
      sender: ZERO_ADDRESS,
      recipient: ZERO_ADDRESS,
      withdrawFromUserBalance: false,
      depositToUserBalance: false,
    };
  });

  type SwapData = {
    poolIdIndex: number;
    tokenInIndex: number;
    tokenOutIndex: number;
    amount: number;
  };

  function swapsDataToSwaps(swapsData: SwapData[]): Swap[] {
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
    function assertQueryBatchSwapGivenIn(swapsData: SwapData[], expectedDeltas: BigNumber[]) {
      it('returns the expected amounts', async () => {
        const swaps: SwapIn[] = toSwapIn(swapsDataToSwaps(swapsData));

        const deltas = await vault.callStatic.queryBatchSwapGivenIn(swaps, tokenAddresses, funds);
        expect(deltas).to.deep.equal(expectedDeltas);
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
        toBigNumberArray([5, -10, 0])
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
        toBigNumberArray([10, -20, 0])
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
        toBigNumberArray([5, 0, -20])
      );
    });
  });

  describe('given out', () => {
    function assertQueryBatchSwapGivenOut(swapsData: SwapData[], expectedDeltas: BigNumber[]) {
      it('returns the expected amounts', async () => {
        const swaps: SwapOut[] = toSwapOut(swapsDataToSwaps(swapsData));

        const deltas = await vault.callStatic.queryBatchSwapGivenOut(swaps, tokenAddresses, funds);
        expect(deltas).to.deep.equal(expectedDeltas);
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
        toBigNumberArray([5, -10, 0])
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
        toBigNumberArray([10, -20, 0])
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
        toBigNumberArray([0, -20, 5])
      );
    });
  });

  describe('helper', () => {
    it('reverts when called directly', async () => {
      const swaps: Swap[] = [
        {
          poolId: poolIds[0],
          tokenInIndex: 0,
          tokenOutIndex: 1,
          amount: 5,
          userData: '0x',
        },
      ];

      await expect(vault.queryBatchSwapHelper(swaps, tokenAddresses, funds, 0)).to.be.revertedWith(
        'Caller is not the Vault'
      );
    });
  });
});

function toBigNumberArray(values: (number | string)[]): BigNumber[] {
  const bigNumbers = [];
  for (const value of values) {
    bigNumbers.push(BigNumber.from(value.toString()));
  }
  return bigNumbers;
}
