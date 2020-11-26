import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { MAX_UINT256 } from '../helpers/constants';
import { expectBalanceChange } from '../helpers/tokenBalance';
import * as expectEvent from '../helpers/expectEvent';
import { TokenList, deployTokens } from '../helpers/tokens';
import { deploy } from '../../scripts/helpers/deploy';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { PairTS, setupPool, TupleTS } from '../../scripts/helpers/pools';
import { toFixedPoint } from '../../scripts/helpers/fixedPoint';
import { FundManagement, SwapIn } from '../../scripts/helpers/trading';

describe('SwapValidator - swaps', () => {
  let controller: SignerWithAddress;
  let trader: SignerWithAddress;

  let vault: Contract;
  let validator: Contract;

  let tokens: TokenList = {};
  let tokenAddresses: string[];

  const totalPools = 2;
  let poolIds: string[];
  let swaps: SwapIn[];
  let funds: FundManagement;

  before('setup', async () => {
    [, controller, trader] = await ethers.getSigners();
  });

  beforeEach('deploy vault & tokens', async () => {
    vault = await deploy('Vault', { args: [] });

    tokens = await deployTokens(['DAI', 'MKR', 'SNX']);
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

    swaps = [
      {
        poolId: poolIds[0],
        tokenInIndex: 1,
        tokenOutIndex: 0,
        amountIn: (1e18).toString(),
        userData: '0x',
      },
    ];

    funds = {
      sender: trader.address,
      recipient: trader.address,
      withdrawFromUserBalance: false,
      depositToUserBalance: false,
    };
  });

  describe('vault', () => {
    beforeEach(async () => {
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
  describe('swap validation', () => {
    beforeEach(async () => {
      validator = await deploy('SwapValidator', { args: [] });
    });

    it('validate correctly', async () => {
      const validatorData = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint128', 'uint128'],
        [tokens.MKR.address, tokens.DAI.address, (1e18).toString(), (2e18).toString()]
      );

      await expectBalanceChange(
        () => vault.connect(trader).batchSwapGivenIn(validator.address, validatorData, swaps, tokenAddresses, funds),
        trader,
        tokens,
        {
          DAI: 2e18,
          MKR: -1e18,
        }
      );
    });

    it('reverts if too many tokens in', async () => {
      const validatorData = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint128', 'uint128'],
        [tokens.MKR.address, tokens.DAI.address, (0.2e18).toString(), (1e18).toString()]
      );

      await expect(
        vault.connect(trader).batchSwapGivenIn(validator.address, validatorData, swaps, tokenAddresses, funds)
      ).to.be.revertedWith('Excessive amount in');
    });

    it('reverts if not enough tokens out', async () => {
      const validatorData = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint128', 'uint128'],
        [tokens.MKR.address, tokens.DAI.address, (1e18).toString(), (3e18).toString()]
      );

      await expect(
        vault.connect(trader).batchSwapGivenIn(validator.address, validatorData, swaps, tokenAddresses, funds)
      ).to.be.revertedWith('Not enough tokens out');
    });
  });
});
