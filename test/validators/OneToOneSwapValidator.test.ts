import { ethers, deployments } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { MAX_UINT256 } from '../helpers/constants';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { TokenList, deployTokens } from '../helpers/tokens';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { PairTS, setupPool, TupleTS } from '../../scripts/helpers/pools';
import { toFixedPoint } from '../../scripts/helpers/fixedPoint';
import { encodeValidatorData, FundManagement, SwapIn } from '../../scripts/helpers/trading';

describe('OneToOneSwapValidator', () => {
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
    await deployments.fixture();
    vault = await ethers.getContract('Vault');

    tokens = await deployTokens(controller.address, ['DAI', 'MKR', 'SNX'], [18, 18, 18]);
    tokenAddresses = [tokens.DAI.address, tokens.MKR.address, tokens.SNX.address];

    poolIds = [];

    for (let poolIdIdx = 0; poolIdIdx < totalPools; ++poolIdIdx) {
      // All pools have mock strategies with an in-out multiplier of 2
      const strategy = await ethers.getContract('MockTradingStrategy');

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
      await tokens[symbol].connect(controller).mint(trader.address, (200e18).toString());
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

    validator = await ethers.getContract('OneToOneSwapValidator');
  });

  it('validates correctly', async () => {
    const validatorData = encodeValidatorData({
      overallTokenIn: tokens.MKR.address,
      overallTokenOut: tokens.DAI.address,
      maximumAmountIn: (1e18).toString(),
      minimumAmountOut: (2e18).toString(),
      deadline: MAX_UINT256,
    });

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

  it('reverts if too many tokens in requested', async () => {
    const validatorData = encodeValidatorData({
      overallTokenIn: tokens.MKR.address,
      overallTokenOut: tokens.DAI.address,
      maximumAmountIn: (0.2e18).toString(),
      minimumAmountOut: (1e18).toString(),
      deadline: MAX_UINT256,
    });

    await expect(
      vault.connect(trader).batchSwapGivenIn(validator.address, validatorData, swaps, tokenAddresses, funds)
    ).to.be.revertedWith('Excessive amount in');
  });

  it('reverts if too little tokens out received', async () => {
    const validatorData = encodeValidatorData({
      overallTokenIn: tokens.MKR.address,
      overallTokenOut: tokens.DAI.address,
      maximumAmountIn: (1e18).toString(),
      minimumAmountOut: (3e18).toString(),
      deadline: MAX_UINT256,
    });
    await expect(
      vault.connect(trader).batchSwapGivenIn(validator.address, validatorData, swaps, tokenAddresses, funds)
    ).to.be.revertedWith('Not enough tokens out');
  });

  it('reverts if other tokens end up with non-zero balance', async () => {
    const validatorData = encodeValidatorData({
      overallTokenIn: tokens.MKR.address,
      overallTokenOut: tokens.DAI.address,
      maximumAmountIn: (2e18).toString(),
      minimumAmountOut: (2e18).toString(),
      deadline: MAX_UINT256,
    });

    swaps = [
      {
        poolId: poolIds[0],
        tokenInIndex: 1,
        tokenOutIndex: 0,
        amountIn: (1e18).toString(),
        userData: '0x',
      },
      {
        poolId: poolIds[0],
        tokenInIndex: 1,
        tokenOutIndex: 2,
        amountIn: (1e18).toString(),
        userData: '0x',
      },
    ];

    await expect(
      vault.connect(trader).batchSwapGivenIn(validator.address, validatorData, swaps, tokenAddresses, funds)
    ).to.be.revertedWith('Intermediate non-zero balance');
  });

  it('reverts if the deadline is in the past', async () => {
    const validatorData = encodeValidatorData({
      overallTokenIn: tokens.MKR.address,
      overallTokenOut: tokens.DAI.address,
      maximumAmountIn: (1e18).toString(),
      minimumAmountOut: (3e18).toString(),
      deadline: (await ethers.provider.getBlock('latest')).timestamp - 10,
    });
    await expect(
      vault.connect(trader).batchSwapGivenIn(validator.address, validatorData, swaps, tokenAddresses, funds)
    ).to.be.revertedWith('Deadline expired');
  });
});
