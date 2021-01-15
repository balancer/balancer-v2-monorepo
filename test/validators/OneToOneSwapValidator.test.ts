import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { MAX_UINT256, ZERO_ADDRESS } from '../helpers/constants';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { TokenList, deployTokens } from '../helpers/tokens';
import { deploy } from '../../scripts/helpers/deploy';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { SimplifiedQuotePool, StandardPool } from '../../scripts/helpers/pools';
import { toFixedPoint } from '../../scripts/helpers/fixedPoint';
import { encodeValidatorData, FundManagement, SwapIn } from '../../scripts/helpers/trading';

describe('OneToOneSwapValidator', () => {
  let lp: SignerWithAddress;
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
    [, lp, trader] = await ethers.getSigners();
  });

  beforeEach('deploy vault & tokens', async () => {
    vault = await deploy('Vault', { args: [ZERO_ADDRESS] });

    tokens = await deployTokens(['DAI', 'MKR', 'SNX'], [18, 18, 18]);
    tokenAddresses = [tokens.DAI.address, tokens.MKR.address, tokens.SNX.address];

    for (const symbol in tokens) {
      // Grant tokens to lp and trader, and approve the Vault to use them
      await tokens[symbol].mint(lp.address, (200e18).toString());
      await tokens[symbol].connect(lp).approve(vault.address, MAX_UINT256);

      await tokens[symbol].mint(trader.address, (200e18).toString());
      await tokens[symbol].connect(trader).approve(vault.address, MAX_UINT256);
    }

    poolIds = [];
    for (let poolIdIdx = 0; poolIdIdx < totalPools; ++poolIdIdx) {
      const poolType = poolIdIdx % 2 ? SimplifiedQuotePool : StandardPool;

      // All pools have mock strategies with an in-out multiplier of 2
      const pool = await deploy('MockPool', {
        args: [vault.address, poolType],
      });

      await vault.connect(lp).addUserAgent(pool.address);

      await pool.connect(lp).registerTokens([tokens.DAI.address, tokens.MKR.address, tokens.SNX.address]);

      await pool
        .connect(lp)
        .addLiquidity(
          [tokens.DAI.address, tokens.MKR.address, tokens.SNX.address],
          [(100e18).toString(), (100e18).toString(), (100e18).toString()]
        );

      await pool.setMultiplier(toFixedPoint(2));

      poolIds.push(await pool.getPoolId());
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
      withdrawFromInternalBalance: false,
      depositToInternalBalance: false,
    };

    validator = await deploy('OneToOneSwapValidator', { args: [] });
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
      tokens,
      { account: trader, changes: { DAI: 2e18, MKR: -1e18 } }
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
