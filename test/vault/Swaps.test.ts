import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { MAX_UINT256 } from '../helpers/constants';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { TokenList, deployTokens } from '../helpers/tokens';
import { deploy } from '../../scripts/helpers/deploy';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { PairTS, setupPool } from '../../scripts/helpers/pools';
import { toFixedPoint } from '../../scripts/helpers/fixedPoint';
import { FundManagement, SwapV2 } from '../../scripts/helpers/trading';

describe('Vault - swaps', () => {
  let controller: SignerWithAddress;
  let trader: SignerWithAddress;
  let other: SignerWithAddress;

  let vault: Contract;
  let tokens: TokenList = {};
  let tokenAddresses: string[];

  const totalPools = 2;
  let poolIds: string[] = [];
  let funds: FundManagement;

  before('setup', async () => {
    [, controller, trader, other] = await ethers.getSigners();
  });

  beforeEach('deploy vault & tokens', async () => {
    vault = await deploy('Vault', { args: [] });
    tokens = await deployTokens(['DAI', 'MKR', 'SNX']);
    tokenAddresses = [tokens.DAI.address, tokens.MKR.address, tokens.SNX.address];

    poolIds = [];
    for (let poolIdIdx = 0; poolIdIdx < totalPools; ++poolIdIdx) {
      // All pools are CWP 1:1:1 DAI:MKR:SNX with no fee
      const strategy = await deploy('CWPTradingStrategy', {
        args: [
          [tokens.DAI.address, tokens.MKR.address, tokens.SNX.address],
          [toFixedPoint(1), toFixedPoint(1), toFixedPoint(1)],
          3,
          0,
        ],
      });

      // Pools are seeded with 200e18 DAO and MKR, making the price 1:1
      poolIds.push(
        await setupPool(vault, strategy, PairTS, tokens, controller, [
          ['DAI', (100e18).toString()],
          ['MKR', (100e18).toString()],
          ['SNX', (100e18).toString()],
        ])
      );
    }

    for (const symbol in tokens) {
      // Mint tokens for trader
      await tokens[symbol].mint(trader.address, (200e18).toString());
      // Approve Vault by trader
      await tokens[symbol].connect(trader).approve(vault.address, MAX_UINT256);
    }

    funds = {
      sender: trader.address,
      recipient: trader.address,
      withdrawFromUserBalance: false,
      depositToUserBalance: false,
    };
  });

  it('single pair single pool swap', async () => {
    // Send 1e18 MKR, get around 1e18 DAI back
    const swaps: SwapV2[] = [
      {
        poolId: poolIds[0],
        tokenInIndex: 1,
        tokenOutIndex: 0,
        amountIn: (1e18).toString(),
        userData: '0x',
      },
    ];

    await expectBalanceChange(() => vault.connect(trader).batchSwap(swaps, tokenAddresses, funds), trader, tokens, {
      DAI: ['near', 1e18],
      MKR: -1e18,
    });
  });

  it('single pair multi pool swap', async () => {
    // In each pool, send 1e18 MKR, get around 1e18 DAI back
    const swaps: SwapV2[] = [
      {
        poolId: poolIds[0],
        tokenInIndex: 1,
        tokenOutIndex: 0,
        amountIn: (1e18).toString(),
        userData: '0x',
      },
      {
        poolId: poolIds[1],
        tokenInIndex: 1,
        tokenOutIndex: 0,
        amountIn: (1e18).toString(),
        userData: '0x',
      },
    ];

    await expectBalanceChange(
      async () => {
        await vault.connect(trader).batchSwap(swaps, tokenAddresses, funds);
      },
      trader,
      tokens,
      { DAI: ['near', 2e18], MKR: -2e18 }
    );
  });

  it('multi pair multi pool swap', async () => {
    const swaps: SwapV2[] = [
      // Send 1e18 MKR, get around 1e18 DAI back
      {
        poolId: poolIds[0],
        tokenInIndex: 1,
        tokenOutIndex: 0,
        amountIn: (1e18).toString(),
        userData: '0x',
      },
      // Send 1e18 MKR, get around 1e18 SNX back
      {
        poolId: poolIds[1],
        tokenInIndex: 1,
        tokenOutIndex: 2,
        amountIn: (1e18).toString(),
        userData: '0x',
      },
    ];

    await expectBalanceChange(
      async () => {
        await vault.connect(trader).batchSwap(swaps, tokenAddresses, funds);
      },
      trader,
      tokens,
      { DAI: ['near', 1e18], SNX: ['near', 1e18], MKR: -2e18 }
    );
  });

  it('multi pair multi pool multihop swap', async () => {
    const swaps: SwapV2[] = [
      // Send 1e18 MKR, get around 1e18 DAI back
      {
        poolId: poolIds[0],
        tokenInIndex: 1,
        tokenOutIndex: 0,
        amountIn: (1e18).toString(),
        userData: '0x',
      },
      // Sends the previously acquired amount of DAI, gets around 1e18 SNX back
      {
        poolId: poolIds[1],
        tokenInIndex: 0,
        tokenOutIndex: 2,
        amountIn: 0, // sentinel value for 'use previous output'
        userData: '0x',
      },
    ];

    await expectBalanceChange(
      async () => {
        await vault.connect(trader).batchSwap(swaps, tokenAddresses, funds);
      },
      trader,
      tokens,
      { SNX: ['near', 1e18], MKR: -1e18 }
    );
  });

  it('reverts if using multihop logic on first swap', async () => {
    const swaps: SwapV2[] = [
      {
        poolId: poolIds[0],
        tokenInIndex: 1,
        tokenOutIndex: 0,
        amountIn: 0,
        userData: '0x',
      },
    ];

    await expect(vault.connect(trader).batchSwap(swaps, tokenAddresses, funds)).to.be.revertedWith(
      'Unknown amount in on first swap'
    );
  });

  it('reverts on multihop token in and out mismatch', async () => {
    const swaps: SwapV2[] = [
      {
        poolId: poolIds[0],
        tokenInIndex: 1,
        tokenOutIndex: 0,
        amountIn: (1e18).toString(),
        userData: '0x',
      },
      {
        poolId: poolIds[1],
        tokenInIndex: 1, // tokenInIndex should be 0, since this is the output of the last swap
        tokenOutIndex: 2,
        amountIn: 0, // sentinel value for 'use previous output'
        userData: '0x',
      },
    ];

    await expect(vault.connect(trader).batchSwap(swaps, tokenAddresses, funds)).to.be.revertedWith(
      'Misconstructed multihop swap'
    );
  });

  it('only transfers tokens for the net vault balance change', async () => {
    // Remove 80% of the DAI tokens from the first pool - this makes DAI much more valuable in this pool
    await vault
      .connect(controller)
      .removeLiquidity(
        poolIds[0],
        controller.address,
        [tokens.DAI.address],
        [(80e18).toString()],
        [(80e18).toString()]
      );

    // Sell DAI in the pool where it is valuable, buy it in the one where it has a regular price
    const swaps: SwapV2[] = [
      {
        poolId: poolIds[0],
        tokenInIndex: 0,
        tokenOutIndex: 1,
        amountIn: (0.8e18).toString(), // 1e18 MKR will be sold for DAI, only 0.8e18 of these are sold here
        userData: '0x',
      },
      {
        poolId: poolIds[1],
        tokenInIndex: 1,
        tokenOutIndex: 0,
        amountIn: (1e18).toString(),
        userData: '0x',
      },
    ];

    // The trader will receive profit in MKR (that was bought by selling DAI for a lot), plus some dust in the form of
    // DAI (since not the entire amount purchased was sold). The trader receives tokens and doesn't send any.
    await expectBalanceChange(
      async () => {
        await vault.connect(trader).batchSwap(swaps, tokenAddresses, funds);
      },
      trader,
      tokens,
      { DAI: ['gt', 0], MKR: ['gt', 0] }
    );
  });

  describe('funds', () => {
    let swaps: SwapV2[];

    beforeEach(async () => {
      swaps = [
        {
          poolId: poolIds[0],
          tokenInIndex: 1,
          tokenOutIndex: 0,
          amountIn: (1e18).toString(),
          userData: '0x',
        },
      ];
    });

    it('can send funds to arbitrary recipient', async () => {
      await expectBalanceChange(
        () => vault.connect(trader).batchSwap(swaps, tokenAddresses, { ...funds, recipient: other.address }),
        other,
        tokens,
        {
          DAI: ['near', 1e18], // The MKR is deducted from trader
        }
      );
    });

    it('cannot withdraw funds from arbitrary sender recipient', async () => {
      await expect(
        vault.connect(other).batchSwap(swaps, tokenAddresses, funds) // funds.sender is trader
      ).to.be.revertedWith('Caller is not operator');
    });

    it('can withdraw funds as operator for sender', async () => {
      await vault.connect(trader).authorizeOperator(other.address);

      await expectBalanceChange(
        () => vault.connect(other).batchSwap(swaps, tokenAddresses, funds), // funds.sender is trader
        trader,
        tokens,
        {
          DAI: ['near', 1e18],
          MKR: -1e18,
        }
      );
    });

    it('can withdraw from user balance before pulling tokens', async () => {
      await vault.connect(trader).deposit(tokens.MKR.address, (0.3e18).toString(), trader.address);

      await expectBalanceChange(
        () => vault.connect(trader).batchSwap(swaps, tokenAddresses, { ...funds, withdrawFromUserBalance: true }),
        trader,
        tokens,
        {
          DAI: ['near', 1e18],
          MKR: -0.7e18, // The 0.3e18 remaining came from User Balance
        }
      );

      expect(await vault.getUserTokenBalance(trader.address, tokens.MKR.address)).to.equal(0);
    });

    it('can deposit into user balance', async () => {
      await expectBalanceChange(
        () => vault.connect(trader).batchSwap(swaps, tokenAddresses, { ...funds, depositToUserBalance: true }),
        trader,
        tokens,
        {
          MKR: -1e18,
        }
      );

      const daiBalance = await vault.getUserTokenBalance(trader.address, tokens.DAI.address);
      expect(daiBalance).to.be.at.least((0.9e18).toString());
      expect(daiBalance).to.be.at.most((1.1e18).toString());
    });
  });
});
