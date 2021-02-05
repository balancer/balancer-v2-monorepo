import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '../../lib/helpers/deploy';
import { fp, bn } from '../../lib/helpers/numbers';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { TokenList, deploySortedTokens } from '../../lib/helpers/tokens';
import { MAX_UINT256, ZERO_ADDRESS } from '../../lib/helpers/constants';
import { MinimalSwapInfoPool, GeneralPool } from '../../lib/helpers/pools';
import { encodeValidatorData, FundManagement, SwapIn } from '../../lib/helpers/trading';
import { encodeJoin } from '../helpers/mockPool';

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
  let assetManagers: string[];

  before('setup', async () => {
    [, lp, trader] = await ethers.getSigners();
  });

  beforeEach('deploy vault & tokens', async () => {
    vault = await deploy('Vault', { args: [ZERO_ADDRESS] });

    tokens = await deploySortedTokens(['DAI', 'MKR', 'SNX'], [18, 18, 18]);
    tokenAddresses = [tokens.DAI.address, tokens.MKR.address, tokens.SNX.address];
    assetManagers = [ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS];

    for (const symbol in tokens) {
      // Grant tokens to lp and trader, and approve the Vault to use them
      await tokens[symbol].mint(lp.address, bn(200e18));
      await tokens[symbol].connect(lp).approve(vault.address, MAX_UINT256);

      await tokens[symbol].mint(trader.address, bn(200e18));
      await tokens[symbol].connect(trader).approve(vault.address, MAX_UINT256);
    }

    poolIds = [];
    for (let poolIdIdx = 0; poolIdIdx < totalPools; ++poolIdIdx) {
      const specialization = poolIdIdx % 2 ? MinimalSwapInfoPool : GeneralPool;

      // All pools have an in-out multiplier of 2
      const pool = await deploy('MockPool', {
        args: [vault.address, specialization],
      });
      const poolId = await pool.getPoolId();

      await pool.setMultiplier(fp(2));

      await pool.registerTokens(tokenAddresses, assetManagers);

      await vault.connect(lp).joinPool(
        poolId,
        lp.address,
        lp.address,
        tokenAddresses,
        tokenAddresses.map(() => MAX_UINT256),
        false,
        encodeJoin(
          tokenAddresses.map(() => bn(100e18)),
          tokenAddresses.map(() => 0)
        )
      );

      poolIds.push(poolId);
    }

    swaps = [
      {
        poolId: poolIds[0],
        tokenInIndex: 1, // MKR
        tokenOutIndex: 0, // DAI
        amountIn: bn(1e18),
        userData: '0x',
      },
    ];

    funds = {
      sender: trader.address,
      recipient: trader.address,
      fromInternalBalance: false,
      toInternalBalance: false,
    };

    validator = await deploy('OneToOneSwapValidator', { args: [] });
  });

  it('validates correctly', async () => {
    const validatorData = encodeValidatorData({
      overallTokenIn: tokens.MKR.address,
      overallTokenOut: tokens.DAI.address,
      maximumAmountIn: bn(1e18),
      minimumAmountOut: bn(2e18),
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
      maximumAmountIn: bn(0.2e18),
      minimumAmountOut: bn(1e18),
      deadline: MAX_UINT256,
    });

    await expect(
      vault.connect(trader).batchSwapGivenIn(validator.address, validatorData, swaps, tokenAddresses, funds)
    ).to.be.revertedWith('EXCESSIVE_AMOUNT_IN');
  });

  it('reverts if too few tokens out received', async () => {
    const validatorData = encodeValidatorData({
      overallTokenIn: tokens.MKR.address,
      overallTokenOut: tokens.DAI.address,
      maximumAmountIn: bn(1e18),
      minimumAmountOut: bn(3e18),
      deadline: MAX_UINT256,
    });
    await expect(
      vault.connect(trader).batchSwapGivenIn(validator.address, validatorData, swaps, tokenAddresses, funds)
    ).to.be.revertedWith('INSUFFICIENT_TOKENS_OUT');
  });

  it('reverts if other tokens end up with non-zero balance', async () => {
    const validatorData = encodeValidatorData({
      overallTokenIn: tokens.MKR.address,
      overallTokenOut: tokens.DAI.address,
      maximumAmountIn: bn(2e18),
      minimumAmountOut: bn(2e18),
      deadline: MAX_UINT256,
    });

    swaps = [
      {
        poolId: poolIds[0],
        tokenInIndex: 1,
        tokenOutIndex: 0,
        amountIn: bn(1e18),
        userData: '0x',
      },
      {
        poolId: poolIds[0],
        tokenInIndex: 1,
        tokenOutIndex: 2,
        amountIn: bn(1e18),
        userData: '0x',
      },
    ];

    await expect(
      vault.connect(trader).batchSwapGivenIn(validator.address, validatorData, swaps, tokenAddresses, funds)
    ).to.be.revertedWith('INTERMEDIATE_NONZERO_BALANCE');
  });

  it('reverts if the deadline is in the past', async () => {
    const validatorData = encodeValidatorData({
      overallTokenIn: tokens.MKR.address,
      overallTokenOut: tokens.DAI.address,
      maximumAmountIn: bn(1e18),
      minimumAmountOut: bn(3e18),
      deadline: (await ethers.provider.getBlock('latest')).timestamp - 10,
    });
    await expect(
      vault.connect(trader).batchSwapGivenIn(validator.address, validatorData, swaps, tokenAddresses, funds)
    ).to.be.revertedWith('DEADLINE_EXPIRED');
  });
});
