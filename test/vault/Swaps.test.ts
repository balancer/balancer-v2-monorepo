import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { MAX_UINT256, ZERO_ADDRESS } from '../helpers/constants';
import { expectBalanceChange } from '../helpers/tokenBalance';
import * as expectEvent from '../helpers/expectEvent';
import { TokenList, deployTokens } from '../helpers/tokens';
import { deploy } from '../../scripts/helpers/deploy';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { PairTS, setupPool, TupleTS } from '../../scripts/helpers/pools';
import { toFixedPoint } from '../../scripts/helpers/fixedPoint';
import { FundManagement, Swap, SwapIn, SwapOut, toSwapIn, toSwapOut } from '../../scripts/helpers/trading';

describe('Vault - swaps', () => {
  let controller: SignerWithAddress;
  let trader: SignerWithAddress;
  let other: SignerWithAddress;

  let vault: Contract;
  let validator: Contract;
  let tokens: TokenList = {};
  let tokenAddresses: string[];

  const totalPools = 2;
  let poolIds: string[];
  let funds: FundManagement;

  before('setup', async () => {
    [, controller, trader, other] = await ethers.getSigners();
  });

  beforeEach('deploy vault & tokens', async () => {
    vault = await deploy('Vault', { args: [controller.address] });
    tokens = await deployTokens(['DAI', 'MKR', 'SNX'], [18, 18, 18]);
    tokenAddresses = [tokens.DAI.address, tokens.MKR.address, tokens.SNX.address];

    poolIds = [];

    for (let poolIdIdx = 0; poolIdIdx < totalPools; ++poolIdIdx) {
      // All pools have mock strategies with an in-out multiplier of 2
      const strategy = await deploy('MockTradingStrategy', {
        args: [],
      });

      strategy.setMultiplier(toFixedPoint(2));

      poolIds.push(
        // Odd pools have Pair Trading Strategies, even ones Tuple
        await setupPool(vault, strategy, poolIdIdx % 2 ? PairTS : TupleTS, tokens, controller, [
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

  describe('swap given in', () => {
    it('single pair single pool swap', async () => {
      // Send 1e18 MKR, get 2e18 DAI back
      const swaps: SwapIn[] = [
        {
          poolId: poolIds[0],
          tokenInIndex: 1,
          tokenOutIndex: 0,
          amountIn: (1e18).toString(),
          userData: '0x',
        },
      ];

      await expectBalanceChange(
        () => vault.connect(trader).batchSwapGivenIn(ZERO_ADDRESS, '0x', swaps, tokenAddresses, funds),
        trader,
        tokens,
        {
          DAI: 2e18,
          MKR: -1e18,
        }
      );
    });

    it('single pair multi pool swap', async () => {
      // In each pool, send 1e18 MKR, get 2e18 DAI back
      const swaps: SwapIn[] = [
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
          await vault.connect(trader).batchSwapGivenIn(ZERO_ADDRESS, '0x', swaps, tokenAddresses, funds);
        },
        trader,
        tokens,
        { DAI: 4e18, MKR: -2e18 }
      );
    });

    it('multi pair multi pool swap', async () => {
      const swaps: SwapIn[] = [
        // Send 1e18 MKR, get 2e18 DAI back
        {
          poolId: poolIds[0],
          tokenInIndex: 1,
          tokenOutIndex: 0,
          amountIn: (1e18).toString(),
          userData: '0x',
        },
        // Send 1e18 MKR, get 2e18 SNX back
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
          await vault.connect(trader).batchSwapGivenIn(ZERO_ADDRESS, '0x', swaps, tokenAddresses, funds);
        },
        trader,
        tokens,
        { DAI: 2e18, SNX: 2e18, MKR: -2e18 }
      );
    });

    it('multi pair multi pool multihop swap', async () => {
      const swaps: SwapIn[] = [
        // Send 1e18 MKR, get 2e18 DAI back
        {
          poolId: poolIds[0],
          tokenInIndex: 1,
          tokenOutIndex: 0,
          amountIn: (1e18).toString(),
          userData: '0x',
        },
        // Send the previously acquired amount of DAI (2e18), get 4e18 SNX back
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
          await vault.connect(trader).batchSwapGivenIn(ZERO_ADDRESS, '0x', swaps, tokenAddresses, funds);
        },
        trader,
        tokens,
        { SNX: 4e18, MKR: -1e18 }
      );
    });

    it('reverts if using multihop logic on first swap', async () => {
      const swaps: SwapIn[] = [
        {
          poolId: poolIds[0],
          tokenInIndex: 1,
          tokenOutIndex: 0,
          amountIn: 0,
          userData: '0x',
        },
      ];

      await expect(
        vault.connect(trader).batchSwapGivenIn(ZERO_ADDRESS, '0x', swaps, tokenAddresses, funds)
      ).to.be.revertedWith('Unknown amount in on first swap');
    });

    it('reverts on multihop token in and out mismatch', async () => {
      const swaps: SwapIn[] = [
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

      await expect(
        vault.connect(trader).batchSwapGivenIn(ZERO_ADDRESS, '0x', swaps, tokenAddresses, funds)
      ).to.be.revertedWith('Misconstructed multihop swap');
    });

    it('only transfers tokens for the net vault balance change', async () => {
      // Make the first pool give back as much as it receives
      const [strategyAddress] = (await vault.getPoolStrategy(poolIds[0])) as [string, unknown];
      const strategy = await ethers.getContractAt('MockTradingStrategy', strategyAddress);

      await strategy.setMultiplier(toFixedPoint(1));

      // Sell DAI in the pool where it is valuable, buy it in the one where it has a regular price
      const swaps: SwapIn[] = [
        {
          poolId: poolIds[1],
          tokenInIndex: 0,
          tokenOutIndex: 1,
          amountIn: (1e18).toString(), // Sell 1e18 DAI for 2e18 MKR
          userData: '0x',
        },
        {
          poolId: poolIds[0],
          tokenInIndex: 1,
          tokenOutIndex: 0,
          amountIn: (1e18).toString(), // Buy 1e18 DAI with 1e18 MKR
          userData: '0x',
        },
      ];

      // The caller will receive profit in MKR, since it sold DAI for more MKR than it bought it for. The caller receives
      // tokens and doesn't send any.
      // Note the caller didn't even have any tokens to begin with.
      await expectBalanceChange(
        async () => {
          await vault.connect(other).batchSwapGivenIn(ZERO_ADDRESS, '0x', swaps, tokenAddresses, {
            ...funds,
            sender: other.address,
            recipient: other.address,
          });
        },
        other,
        tokens,
        { MKR: 1e18 }
      );
    });
  });

  describe('swap given out', () => {
    it('single pair single pool swap', async () => {
      // Get 1e18 DAI by sending 0.5e18 MKR
      const swaps: SwapOut[] = [
        {
          poolId: poolIds[0],
          tokenInIndex: 1,
          tokenOutIndex: 0,
          amountOut: (1e18).toString(),
          userData: '0x',
        },
      ];

      await expectBalanceChange(
        () => vault.connect(trader).batchSwapGivenOut(ZERO_ADDRESS, '0x', swaps, tokenAddresses, funds),
        trader,
        tokens,
        {
          DAI: 1e18,
          MKR: -0.5e18,
        }
      );
    });

    it('single pair multi pool swap', async () => {
      // In each pool, get 1e18 DAI by sending 0.5e18 MKR
      const swaps: SwapOut[] = [
        {
          poolId: poolIds[0],
          tokenInIndex: 1,
          tokenOutIndex: 0,
          amountOut: (1e18).toString(),
          userData: '0x',
        },
        {
          poolId: poolIds[1],
          tokenInIndex: 1,
          tokenOutIndex: 0,
          amountOut: (1e18).toString(),
          userData: '0x',
        },
      ];

      await expectBalanceChange(
        async () => {
          await vault.connect(trader).batchSwapGivenOut(ZERO_ADDRESS, '0x', swaps, tokenAddresses, funds);
        },
        trader,
        tokens,
        { DAI: 2e18, MKR: -1e18 }
      );
    });

    it('multi pair multi pool swap', async () => {
      const swaps: SwapOut[] = [
        // Get 1e18 DAI by sending 0.5e18 DAI
        {
          poolId: poolIds[0],
          tokenInIndex: 1,
          tokenOutIndex: 0,
          amountOut: (1e18).toString(),
          userData: '0x',
        },
        // Get 1e18 SNX by sending 0.5e18 MKR
        {
          poolId: poolIds[1],
          tokenInIndex: 1,
          tokenOutIndex: 2,
          amountOut: (1e18).toString(),
          userData: '0x',
        },
      ];

      await expectBalanceChange(
        async () => {
          await vault.connect(trader).batchSwapGivenOut(ZERO_ADDRESS, '0x', swaps, tokenAddresses, funds);
        },
        trader,
        tokens,
        { DAI: 1e18, SNX: 1e18, MKR: -1e18 }
      );
    });

    it('multi pair multi pool multihop swap', async () => {
      const swaps: SwapOut[] = [
        // Get 1e18 SNX by sending 0.5e18 DAI
        {
          poolId: poolIds[0],
          tokenInIndex: 0,
          tokenOutIndex: 2,
          amountOut: (1e18).toString(),
          userData: '0x',
        },
        // Get the previously required amount of DAI (0.5e18) by sending 0.25e18 MKR
        {
          poolId: poolIds[1],
          tokenInIndex: 1,
          tokenOutIndex: 0,
          amountOut: 0, // sentinel value for 'use previous output'
          userData: '0x',
        },
      ];

      await expectBalanceChange(
        async () => {
          await vault.connect(trader).batchSwapGivenOut(ZERO_ADDRESS, '0x', swaps, tokenAddresses, funds);
        },
        trader,
        tokens,
        { SNX: 1e18, MKR: -0.25e18 }
      );
    });

    it('reverts if using multihop logic on first swap', async () => {
      const swaps: SwapOut[] = [
        {
          poolId: poolIds[0],
          tokenInIndex: 1,
          tokenOutIndex: 0,
          amountOut: 0,
          userData: '0x',
        },
      ];

      await expect(
        vault.connect(trader).batchSwapGivenOut(ZERO_ADDRESS, '0x', swaps, tokenAddresses, funds)
      ).to.be.revertedWith('Unknown amount in on first swap');
    });

    it('reverts on multihop token in and out mismatch', async () => {
      const swaps: SwapOut[] = [
        {
          poolId: poolIds[0],
          tokenInIndex: 1,
          tokenOutIndex: 0,
          amountOut: (1e18).toString(),
          userData: '0x',
        },
        {
          poolId: poolIds[1],
          tokenInIndex: 2,
          tokenOutIndex: 0, // tokenOutIndex should be 0, since this is the input of the last swap
          amountOut: 0, // sentinel value for 'use previous output'
          userData: '0x',
        },
      ];

      await expect(
        vault.connect(trader).batchSwapGivenOut(ZERO_ADDRESS, '0x', swaps, tokenAddresses, funds)
      ).to.be.revertedWith('Misconstructed multihop swap');
    });

    it('only transfers tokens for the net vault balance change', async () => {
      // Make the first pool give back as much as it receives
      const [strategyAddress] = (await vault.getPoolStrategy(poolIds[0])) as [string, unknown];
      const strategy = await ethers.getContractAt('MockTradingStrategy', strategyAddress);

      await strategy.setMultiplier(toFixedPoint(1));

      // Sell DAI in the pool where it is valuable, buy it in the one where it has a regular price
      const swaps: SwapOut[] = [
        {
          poolId: poolIds[1],
          tokenInIndex: 0,
          tokenOutIndex: 1,
          amountOut: (2e18).toString(), // Sell 1e18 DAI for 2e18 MKR
          userData: '0x',
        },
        {
          poolId: poolIds[0],
          tokenInIndex: 1,
          tokenOutIndex: 0,
          amountOut: (1e18).toString(), // Buy 1e18 DAI with 1e18 MKR
          userData: '0x',
        },
      ];

      // The caller will receive profit in MKR, since it sold DAI for more MKR than it bought it for. The caller receives
      // tokens and doesn't send any.
      // Note the caller didn't even have tokens to begin with.
      await expectBalanceChange(
        async () => {
          await vault.connect(other).batchSwapGivenOut(ZERO_ADDRESS, '0x', swaps, tokenAddresses, {
            ...funds,
            sender: other.address,
            recipient: other.address,
          });
        },
        other,
        tokens,
        { MKR: 1e18 }
      );
    });
  });

  describe('funds', () => {
    let swaps: SwapIn[];

    beforeEach(async () => {
      swaps = [
        {
          poolId: poolIds[0],
          tokenInIndex: 1,
          tokenOutIndex: 0,
          amountIn: (1e18).toString(), // Sell 1e18 MKR for 2e18 DAI
          userData: '0x',
        },
      ];
    });

    it('can send funds to arbitrary recipient', async () => {
      await expectBalanceChange(
        () =>
          vault.connect(trader).batchSwapGivenIn(ZERO_ADDRESS, '0x', swaps, tokenAddresses, {
            ...funds,
            recipient: other.address,
          }),
        other,
        tokens,
        {
          DAI: 2e18, // The MKR is deducted from trader
        }
      );
    });

    it('cannot withdraw funds from arbitrary sender recipient', async () => {
      await expect(
        vault.connect(other).batchSwapGivenIn(ZERO_ADDRESS, '0x', swaps, tokenAddresses, funds) // funds.sender is trader
      ).to.be.revertedWith('Caller is not operator');
    });

    it('can withdraw funds as operator for sender', async () => {
      await vault.connect(trader).authorizeOperator(other.address);

      await expectBalanceChange(
        () => vault.connect(other).batchSwapGivenIn(ZERO_ADDRESS, '0x', swaps, tokenAddresses, funds), // funds.sender is trader
        trader,
        tokens,
        {
          DAI: 2e18,
          MKR: -1e18,
        }
      );
    });

    it('can withdraw from user balance before pulling tokens', async () => {
      await vault.connect(trader).deposit(tokens.MKR.address, (0.3e18).toString(), trader.address);

      await expectBalanceChange(
        () =>
          vault.connect(trader).batchSwapGivenIn(ZERO_ADDRESS, '0x', swaps, tokenAddresses, {
            ...funds,
            withdrawFromUserBalance: true,
          }),
        trader,
        tokens,
        {
          DAI: 2e18,
          MKR: -0.7e18, // The 0.3e18 remaining came from User Balance
        }
      );

      expect(await vault.getUserTokenBalance(trader.address, tokens.MKR.address)).to.equal(0);
    });

    it('can deposit into user balance', async () => {
      await expectBalanceChange(
        () =>
          vault.connect(trader).batchSwapGivenIn(ZERO_ADDRESS, '0x', swaps, tokenAddresses, {
            ...funds,
            depositToUserBalance: true,
          }),
        trader,
        tokens,
        {
          MKR: -1e18,
        }
      );

      const daiBalance = await vault.getUserTokenBalance(trader.address, tokens.DAI.address);
      expect(daiBalance).to.equal((2e18).toString());
    });
  });

  describe('reentrancy', () => {
    let swaps: SwapIn[];

    beforeEach(async () => {
      //Create a strategy that reenters the vault batchswap function.
      const strategy = await deploy('MockTradingStrategyReentrancy', {
        args: [vault.address],
      });

      const poolId = await setupPool(vault, strategy, PairTS, tokens, controller, [
        ['DAI', (100e18).toString()],
        ['MKR', (100e18).toString()],
        ['SNX', (100e18).toString()],
      ]);
      swaps = [
        {
          poolId,
          tokenInIndex: 1,
          tokenOutIndex: 0,
          amountIn: (1e18).toString(), // Sell 1e18 MKR for 2e18 DAI
          userData: '0x',
        },
      ];
    });

    it('reverts if batchswap is called twice', async () => {
      await expect(
        vault.connect(trader).batchSwapGivenIn(ZERO_ADDRESS, '0x', swaps, tokenAddresses, funds)
      ).to.be.revertedWith('reentrant call');
    });
  });

  describe('validators', () => {
    beforeEach('deploy validator', async () => {
      validator = await deploy('MockSwapValidator', { args: [] });
    });

    it.skip('call validator with correct data', async () => {
      const overallTokenIn = tokens.MKR.address;
      const overallTokenOut = tokens.DAI.address;
      const maxAmountIn = (33e18).toString();
      const minAmountOut = (22e18).toString();

      const validatorData = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint128', 'uint128'],
        [overallTokenIn, overallTokenOut, maxAmountIn, minAmountOut]
      );

      // Send 1e18 MKR, get 2e18 DAI back
      const swaps: SwapIn[] = [
        {
          poolId: poolIds[0],
          tokenInIndex: 1,
          tokenOutIndex: 0,
          amountIn: (1e18).toString(),
          userData: '0x',
        },
      ];

      const receipt = await (
        await vault.connect(trader).batchSwapGivenIn(validator.address, validatorData, swaps, tokenAddresses, funds)
      ).wait();

      expectEvent.inReceipt(receipt, 'ValidationData', {
        overallTokenIn,
        overallTokenOut,
        maxAmountIn,
        minAmountOut: maxAmountIn,
      });
    });
  });

  describe('failure conditions', async () => {
    let tokenAddressesWithInvalid: string[];
    let invalidTokenIndex: number;

    beforeEach(async () => {
      const { INV: invalidToken } = await deployTokens(['INV'], [18]);
      tokenAddressesWithInvalid = tokenAddresses.concat(invalidToken.address);
      invalidTokenIndex = tokenAddressesWithInvalid.length - 1;
    });

    it('reverts if token in is not in the pool', async () => {
      const swaps: Swap[] = [
        {
          poolId: poolIds[0],
          tokenInIndex: invalidTokenIndex,
          tokenOutIndex: 0,
          amount: (1e18).toString(),
          userData: '0x',
        },
      ];

      await expect(
        vault.connect(trader).batchSwapGivenIn(ZERO_ADDRESS, '0x', toSwapIn(swaps), tokenAddressesWithInvalid, funds)
      ).to.be.revertedWith('Token A not in pool');

      await expect(
        vault.connect(trader).batchSwapGivenOut(ZERO_ADDRESS, '0x', toSwapOut(swaps), tokenAddressesWithInvalid, funds)
      ).to.be.revertedWith('Token A not in pool');
    });

    it('reverts if token B not in pool', async () => {
      const swaps: Swap[] = [
        {
          poolId: poolIds[0],
          tokenInIndex: 0,
          tokenOutIndex: invalidTokenIndex,
          amount: (1e18).toString(),
          userData: '0x',
        },
      ];

      await expect(
        vault.connect(trader).batchSwapGivenIn(ZERO_ADDRESS, '0x', toSwapIn(swaps), tokenAddressesWithInvalid, funds)
      ).to.be.revertedWith('Token B not in pool');

      await expect(
        vault.connect(trader).batchSwapGivenOut(ZERO_ADDRESS, '0x', toSwapOut(swaps), tokenAddressesWithInvalid, funds)
      ).to.be.revertedWith('Token B not in pool');
    });

    it('reverts if the pool has insufficient cash for token out on given in', async () => {
      const swaps: SwapIn[] = [
        {
          poolId: poolIds[0],
          tokenInIndex: 1,
          tokenOutIndex: 0,
          amountIn: BigNumber.from((50e18).toString()).add(1).toString(),
          userData: '0x',
        },
      ];

      await expect(
        vault.connect(trader).batchSwapGivenIn(ZERO_ADDRESS, '0x', swaps, tokenAddresses, funds)
      ).to.be.revertedWith('ERR_SUB_UNDERFLOW');
    });

    it('reverts if the pool has insufficient cash for token out on given out', async () => {
      const swaps: SwapOut[] = [
        {
          poolId: poolIds[0],
          tokenInIndex: 1,
          tokenOutIndex: 0,
          amountOut: BigNumber.from((100e18).toString()).add(1).toString(),
          userData: '0x',
        },
      ];

      await expect(
        vault.connect(trader).batchSwapGivenOut(ZERO_ADDRESS, '0x', swaps, tokenAddresses, funds)
      ).to.be.revertedWith('ERR_SUB_UNDERFLOW');
    });

    it('reverts if trying to swap for same token', async () => {
      const swaps: Swap[] = [
        {
          poolId: poolIds[0],
          tokenInIndex: 1,
          tokenOutIndex: 1,
          amount: (1e18).toString(),
          userData: '0x',
        },
      ];

      await expect(
        vault.connect(trader).batchSwapGivenIn(ZERO_ADDRESS, '0x', toSwapIn(swaps), tokenAddresses, funds)
      ).to.be.revertedWith('Swap for same token');

      await expect(
        vault.connect(trader).batchSwapGivenOut(ZERO_ADDRESS, '0x', toSwapOut(swaps), tokenAddresses, funds)
      ).to.be.revertedWith('Swap for same token');
    });
  });
});
