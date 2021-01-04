import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import * as expectEvent from '../helpers/expectEvent';
import { TokenList, deployTokens, mintTokens } from '../helpers/tokens';
import { deploy } from '../../scripts/helpers/deploy';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { MAX_UINT256, ZERO_ADDRESS } from '../helpers/constants';
import { PairTS, TradingStrategyType, TupleTS, TwoTokenTS } from '../../scripts/helpers/pools';
import { expectBalanceChange } from '../helpers/tokenBalance';

let pool: SignerWithAddress;
let lp: SignerWithAddress;
let other: SignerWithAddress;

let vault: Contract;
let tokens: TokenList = {};

describe('Vault - pool registry', () => {
  before(async () => {
    [, pool, lp, other] = await ethers.getSigners();
  });

  beforeEach('deploy vault & tokens', async () => {
    vault = await deploy('Vault', { args: [ZERO_ADDRESS] });
    tokens = await deployTokens(['DAI', 'MKR', 'SNX'], [18, 18, 18]);

    for (const symbol in tokens) {
      // Mint tokens for the lp to deposit in the Vault
      await mintTokens(tokens, symbol, lp, 500);
      await tokens[symbol].connect(lp).approve(vault.address, MAX_UINT256);

      // Also mint some tokens for the pool itself
      await mintTokens(tokens, symbol, pool, 500);
      await tokens[symbol].connect(pool).approve(vault.address, MAX_UINT256);
    }
  });

  describe('pool creation', () => {
    it('anyone can create pools', async () => {
      const receipt = await (await vault.connect(pool).newPool(pool.address, TupleTS)).wait();

      const event = expectEvent.inReceipt(receipt, 'PoolCreated');
      const poolId = event.args.poolId;

      expect(poolId).to.not.be.undefined;
    });

    it('the pool address must be non-zero', async () => {
      await expect(vault.newPool(ZERO_ADDRESS, TupleTS)).to.be.revertedWith('Strategy must be set');
    });

    it('pools require a valid pool type', async () => {
      // The existing pool types are pair, tuple, and two tokens (0, 1 and 2)
      await expect(vault.newPool(pool.address, 3)).to.be.reverted;
    });
  });

  describe('pool properties', () => {
    let poolId: string;

    beforeEach(async () => {
      const receipt = await (await vault.newPool(pool.address, TupleTS)).wait();

      const event = expectEvent.inReceipt(receipt, 'PoolCreated');
      poolId = event.args.poolId;
    });

    it('new pool is added to pool list', async () => {
      expect(await vault.getNumberOfPools()).to.equal(1);
      expect(await vault.getPoolIds(0, 1)).to.have.members([poolId]);
    });

    it('pool and type are set', async () => {
      expect(await vault.getPool(poolId)).to.deep.equal([pool.address, TupleTS]);
    });

    it('pool starts with no tokens', async () => {
      expect(await vault.getPoolTokens(poolId)).to.have.members([]);
    });

    it('new pool gets a different id', async () => {
      const receipt = await (await vault.newPool(pool.address, TupleTS)).wait();

      const event = expectEvent.inReceipt(receipt, 'PoolCreated');
      const otherPoolId = event.args.poolId;

      expect(poolId).to.not.equal(otherPoolId);
      expect(await vault.getNumberOfPools()).to.equal(2);
      expect(await vault.getPoolIds(0, 2)).to.have.members([poolId, otherPoolId]);
    });
  });

  describe('token management', () => {
    describe('with pair trading strategies', () => {
      itManagesTokensCorrectly(PairTS);
    });

    describe('with tuple trading strategies', () => {
      itManagesTokensCorrectly(TupleTS);
    });

    describe('with two token trading strategies', () => {
      itManagesTokensCorrectly(TwoTokenTS);
    });
  });
});

function itManagesTokensCorrectly(strategyType: TradingStrategyType) {
  let poolId: string;

  beforeEach(async () => {
    const receipt = await (await vault.newPool(pool.address, strategyType)).wait();

    const event = expectEvent.inReceipt(receipt, 'PoolCreated');
    poolId = event.args.poolId;
  });

  if (strategyType != TwoTokenTS) {
    it('pool can add liquidity to single token', async () => {
      await vault.connect(pool).addLiquidity(poolId, pool.address, [tokens.DAI.address], [5], false);
      expect(await vault.getPoolTokens(poolId)).to.have.members([tokens.DAI.address]);

      expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address])).to.deep.equal([BigNumber.from(5)]);
    });
  }

  it('pool can add liquidity to multiple tokens', async () => {
    await vault
      .connect(pool)
      .addLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [5, 10], false);
    expect(await vault.getPoolTokens(poolId)).to.have.members([tokens.DAI.address, tokens.MKR.address]);

    expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address, tokens.MKR.address])).to.deep.equal([
      BigNumber.from(5),
      BigNumber.from(10),
    ]);
  });

  it('pool cannot add liquidity for the zero address token', async () => {
    await expect(
      vault.connect(pool).addLiquidity(poolId, pool.address, [tokens.DAI.address, ZERO_ADDRESS], [5, 10], false)
    ).to.be.revertedWith('Token is the zero address');

    await expect(
      vault.connect(pool).addLiquidity(poolId, pool.address, [ZERO_ADDRESS, tokens.MKR.address], [5, 10], false)
    ).to.be.revertedWith('Token is the zero address');
  });

  it('the pool cannot add zero liquidity to new tokens', async () => {
    await expect(
      vault.connect(pool).addLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [5, 0], false)
    ).to.be.revertedWith('New token amount is zero');

    await expect(
      vault.connect(pool).addLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [0, 10], false)
    ).to.be.revertedWith('New token amount is zero');
  });

  it('the pool cannot add liquidity with mismatching tokens and lengths', async () => {
    await expect(
      vault
        .connect(pool)
        .addLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [5, 10, 15], false)
    ).to.be.revertedWith('Tokens and total amounts length mismatch');
  });

  it('the pool can add liquidity multiple times', async () => {
    await vault
      .connect(pool)
      .addLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [3, 7], false);
    await vault
      .connect(pool)
      .addLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [5, 10], false);

    expect(await vault.getPoolTokens(poolId)).to.have.members([tokens.DAI.address, tokens.MKR.address]);
    expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address, tokens.MKR.address])).to.deep.equal([
      BigNumber.from(8),
      BigNumber.from(17),
    ]);
  });

  it('tokens are pulled from the lp when adding liquidity', async () => {
    await vault.connect(lp).addUserAgent(pool.address);

    await expectBalanceChange(
      () =>
        vault.connect(pool).addLiquidity(poolId, lp.address, [tokens.DAI.address, tokens.MKR.address], [5, 10], false),
      tokens,
      [
        { account: lp, changes: { DAI: -5, MKR: -10 } },
        { account: vault.address, changes: { DAI: 5, MKR: 10 } },
      ]
    );
  });

  it('the pool must be an agent for the lp to adding liquidity', async () => {
    await expect(
      vault.connect(pool).addLiquidity(poolId, lp.address, [tokens.DAI.address, tokens.MKR.address], [5, 10], false)
    ).to.be.revertedWith('Caller is not an agent');
  });

  it('the pool can add liquidity by withdrawing tokens from user balance', async () => {
    await vault.connect(pool).deposit(tokens.DAI.address, 50, pool.address);
    await vault.connect(pool).deposit(tokens.MKR.address, 100, pool.address);

    await expectBalanceChange(
      () =>
        vault.connect(pool).addLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [5, 10], true),
      tokens,
      [{ account: pool }]
    );

    expect(await vault.getUserTokenBalance(pool.address, tokens.DAI.address)).to.equal(45); // 5 out of 50 taken
    expect(await vault.getUserTokenBalance(pool.address, tokens.MKR.address)).to.equal(90); // 10 out of 100 taken
  });

  it('the pool can add liquidity by both transferring and withdrawing tokens from user balance', async () => {
    await vault.connect(pool).deposit(tokens.DAI.address, 3, pool.address);
    await vault.connect(pool).deposit(tokens.MKR.address, 6, pool.address);

    await expectBalanceChange(
      () =>
        vault.connect(pool).addLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [5, 10], true),
      tokens,
      [{ account: pool, changes: { DAI: -2, MKR: -4 } }]
    );

    expect(await vault.getUserTokenBalance(pool.address, tokens.DAI.address)).to.equal(0);
    expect(await vault.getUserTokenBalance(pool.address, tokens.MKR.address)).to.equal(0);
  });

  it('non-pool cannot add liquidity', async () => {
    await expect(
      vault.connect(other).addLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [5, 10], false)
    ).to.be.revertedWith('Caller is not the pool');
  });

  if (strategyType == TwoTokenTS) {
    it('the pool cannot add liquidity to single token', async () => {
      await expect(
        vault.connect(pool).addLiquidity(poolId, pool.address, [tokens.DAI.address], [5], false)
      ).to.be.revertedWith('Must interact with all tokens in two token pool');
    });

    it('the pool cannot add liquidity to more than two tokens', async () => {
      await expect(
        vault
          .connect(pool)
          .addLiquidity(
            poolId,
            pool.address,
            [tokens.DAI.address, tokens.MKR.address, tokens.SNX.address],
            [5, 10, 15],
            false
          )
      ).to.be.revertedWith('Must interact with all tokens in two token pool');
    });

    it('the pool cannot add liquidity to repeated tokens', async () => {
      await expect(
        vault.connect(pool).addLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.DAI.address], [5, 10], false)
      ).to.be.revertedWith('Tokens are the same');
    });
  }

  context('with added liquidity', () => {
    beforeEach(async () => {
      await vault
        .connect(pool)
        .addLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [5, 10], false);
    });

    if (strategyType != TwoTokenTS) {
      it('the pool can remove zero liquidity from single token', async () => {
        await vault.connect(pool).removeLiquidity(poolId, pool.address, [tokens.MKR.address], [0], false);

        expect(await vault.getPoolTokens(poolId)).to.have.members([tokens.DAI.address, tokens.MKR.address]);
        expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address, tokens.MKR.address])).to.deep.equal([
          BigNumber.from(5),
          BigNumber.from(10),
        ]);
      });

      it('the pool can remove partial liquidity from single token', async () => {
        await vault.connect(pool).removeLiquidity(poolId, pool.address, [tokens.MKR.address], [8], false);

        expect(await vault.getPoolTokens(poolId)).to.have.members([tokens.DAI.address, tokens.MKR.address]);
        expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address, tokens.MKR.address])).to.deep.equal([
          BigNumber.from(5),
          BigNumber.from(2),
        ]);
      });

      it('the pool can remove all liquidity from single token', async () => {
        await vault.connect(pool).removeLiquidity(poolId, pool.address, [tokens.MKR.address], [10], false);

        expect(await vault.getPoolTokens(poolId)).to.have.members([tokens.DAI.address]);
        expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address])).to.deep.equal([BigNumber.from(5)]);
      });
    }

    if (strategyType == TwoTokenTS) {
      it('the pool cannot remove zero liquidity from single token', async () => {
        await expect(
          vault.connect(pool).removeLiquidity(poolId, pool.address, [tokens.MKR.address], [0], false)
        ).to.be.revertedWith('Must interact with all tokens in two token pool');
      });
    }

    it('the pool can remove zero liquidity from multiple tokens', async () => {
      await vault
        .connect(pool)
        .removeLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [0, 3], false);

      expect(await vault.getPoolTokens(poolId)).to.have.members([tokens.DAI.address, tokens.MKR.address]);
      expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address, tokens.MKR.address])).to.deep.equal([
        BigNumber.from(5),
        BigNumber.from(7),
      ]);
    });

    it('the pool can remove partial liquidity from multiple tokens', async () => {
      await vault
        .connect(pool)
        .removeLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [2, 3], false);

      expect(await vault.getPoolTokens(poolId)).to.have.members([tokens.DAI.address, tokens.MKR.address]);
      expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address, tokens.MKR.address])).to.deep.equal([
        BigNumber.from(3),
        BigNumber.from(7),
      ]);
    });

    it('the pool can remove all liquidity from multiple tokens', async () => {
      await vault
        .connect(pool)
        .removeLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [5, 10], false);

      expect(await vault.getPoolTokens(poolId)).to.have.members([]);
    });

    it('the pool can remove liquidity by depositing tokens into user balance', async () => {
      await expectBalanceChange(
        () =>
          vault
            .connect(pool)
            .removeLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [4, 8], true),
        tokens,
        [{ account: pool }]
      );

      expect(await vault.getUserTokenBalance(pool.address, tokens.DAI.address)).to.equal(4);
      expect(await vault.getUserTokenBalance(pool.address, tokens.MKR.address)).to.equal(8);
    });

    it('tokens are pushed to lp when removing liquidity', async () => {
      await expectBalanceChange(
        () =>
          vault
            .connect(pool)
            .removeLiquidity(poolId, lp.address, [tokens.DAI.address, tokens.MKR.address], [2, 7], false),
        tokens,
        [
          { account: vault.address, changes: { DAI: -2, MKR: -7 } },
          { account: lp, changes: { DAI: 2, MKR: 7 } },
        ]
      );
    });

    it('the controller cannot remove zero liquidity not in pool', async () => {
      await expect(
        vault
          .connect(pool)
          .removeLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.SNX.address], [5, 0], false)
      ).to.be.revertedWith('Token not in pool');
    });

    it('the controller cannot remove non-zero liquidity not in pool', async () => {
      await expect(
        vault
          .connect(pool)
          .removeLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.SNX.address], [5, 2], false)
      ).to.be.revertedWith('Token not in pool');
    });

    it('non-pool cannot remove liquidity', async () => {
      await expect(
        vault
          .connect(other)
          .removeLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [0, 0], false)
      ).to.be.revertedWith('Caller is not the pool');
    });
  });
}
