import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy } from '../../scripts/helpers/deploy';
import { PairTS } from '../../scripts/helpers/pools';
import { deployTokens, TokenList } from '../helpers/tokens';
import { MAX_UINT256 } from '../helpers/constants';
import { expectBalanceChange } from '../helpers/tokenBalance';

describe('FixedSetPoolTokenizer', function () {
  let lp: SignerWithAddress;
  let other: SignerWithAddress;

  let poolId: string;

  let vault: Contract;
  let strategy: Contract;
  let tokenizer: Contract;
  let tokens: TokenList = {};

  before(async function () {
    [, lp, other] = await ethers.getSigners();
  });

  beforeEach(async function () {
    vault = await deploy('Vault', { args: [] });

    tokens = await deployTokens(['DAI', 'MKR']);
    await Promise.all(
      ['DAI', 'MKR'].map(async (token) => {
        await tokens[token].mint(lp.address, (100e18).toString());
        await tokens[token].connect(lp).approve(vault.address, MAX_UINT256);

        await tokens[token].mint(other.address, (100e18).toString());
        await tokens[token].connect(other).approve(vault.address, MAX_UINT256);
      })
    );

    strategy = await deploy('MockTradingStrategy', { args: [] });
    tokenizer = await deploy('FixedSetPoolTokenizer', { args: [vault.address, strategy.address, PairTS] });

    await vault.connect(lp).authorizeOperator(tokenizer.address);
    await vault.connect(other).authorizeOperator(tokenizer.address);

    poolId = await tokenizer.poolId();
  });

  it('creates a pool in the vault', async () => {
    expect(await vault.getPoolController(poolId)).to.equal(tokenizer.address);
  });

  // TODO: this will be part of the constructor once the initialize function is removed
  describe('initialization', () => {
    it('grants initial BPT to the LP', async () => {
      await tokenizer
        .connect(lp)
        .initialize(
          (100e18).toString(),
          [tokens.DAI.address, tokens.MKR.address],
          [(1e18).toString(), (2e18).toString()]
        );

      expect(await tokenizer.balanceOf(lp.address)).to.equal((100e18).toString());
    });

    it('adds tokens to pool', async () => {
      await tokenizer
        .connect(lp)
        .initialize(
          (100e18).toString(),
          [tokens.DAI.address, tokens.MKR.address],
          [(1e18).toString(), (2e18).toString()]
        );

      expect(await vault.getPoolTokens(poolId)).to.have.members([tokens.DAI.address, tokens.MKR.address]);
    });

    it('fails of the tokenizer is not authorized', async () => {
      await vault.connect(lp).revokeOperator(tokenizer.address);

      await expect(
        tokenizer
          .connect(lp)
          .initialize(
            (100e18).toString(),
            [tokens.DAI.address, tokens.MKR.address],
            [(1e18).toString(), (2e18).toString()]
          )
      ).to.be.revertedWith('Caller is not operator');
    });

    it('sends LP tokens to the Vault', async () => {
      await expectBalanceChange(
        () =>
          tokenizer
            .connect(lp)
            .initialize(
              (100e18).toString(),
              [tokens.DAI.address, tokens.MKR.address],
              [(1e18).toString(), (2e18).toString()]
            ),
        lp,
        tokens,
        { DAI: -1e18, MKR: -2e18 }
      );

      expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address, tokens.MKR.address])).to.deep.equal([
        BigNumber.from((1e18).toString()),
        BigNumber.from((2e18).toString()),
      ]);
    });
  });

  describe('joining', () => {
    beforeEach(async () => {
      await tokenizer
        .connect(lp)
        .initialize(
          (100e18).toString(),
          [tokens.DAI.address, tokens.MKR.address],
          [(1e18).toString(), (2e18).toString()]
        );
    });

    it('grants BPT in return', async () => {
      const previousBPT = await tokenizer.balanceOf(lp.address);

      // To get 10% of the current BTP, an LP needs to supply 10% of the current token balance
      await tokenizer.connect(lp).joinPool((10e18).toString(), [(0.1e18).toString(), (0.2e18).toString()], true);

      const newBPT = await tokenizer.balanceOf(lp.address);
      expect(newBPT.sub(previousBPT)).to.equal((10e18).toString());
    });

    it('fails if maximum amounts are not enough', async () => {
      await expect(
        tokenizer
          .connect(lp)
          .joinPool((10e18).toString(), [BigNumber.from((0.1e18).toString()).sub(1), (0.2e18).toString()], true)
      ).to.be.revertedWith('ERR_LIMIT_IN');

      await expect(
        tokenizer
          .connect(lp)
          .joinPool((10e18).toString(), [(0.1e18).toString(), BigNumber.from((0.2e18).toString()).sub(1)], true)
      ).to.be.revertedWith('ERR_LIMIT_IN');
    });

    it('only the required tokens are pulled', async () => {
      await expectBalanceChange(
        () => tokenizer.connect(lp).joinPool((10e18).toString(), [(10e18).toString(), (10e18).toString()], true),
        lp,
        tokens,
        { DAI: -0.1e18, MKR: -0.2e18 }
      );
    });

    it('anybody can join the pool', async () => {
      await tokenizer.connect(other).joinPool((10e18).toString(), [(0.1e18).toString(), (0.2e18).toString()], true);

      expect(await tokenizer.balanceOf(other.address)).to.equal((10e18).toString());
    });

    it('fails if not supplying all tokens', async () => {
      await expect(
        tokenizer.connect(lp).joinPool((10e18).toString(), [(0.1e18).toString()], [(0.1e18).toString()])
      ).to.be.revertedWith('Tokens and amounts length mismatch');
    });

    it('fails if supplying extra tokens', async () => {
      await expect(
        tokenizer
          .connect(lp)
          .joinPool((10e18).toString(), [(0.1e18).toString(), (0.2e18).toString(), (0.3e18).toString()], true)
      ).to.be.revertedWith('Tokens and amounts length mismatch');
    });

    it('can withdraw from user balance', async () => {
      await vault.connect(lp).deposit(tokens.DAI.address, (1e18).toString(), lp.address);
      await vault.connect(lp).deposit(tokens.MKR.address, (1e18).toString(), lp.address);

      await expectBalanceChange(
        () => tokenizer.connect(lp).joinPool((10e18).toString(), [(0.1e18).toString(), (0.2e18).toString()], false),
        lp,
        tokens,
        {}
      );

      expect(await vault.getUserTokenBalance(lp.address, tokens.DAI.address)).to.equal((0.9e18).toString());
      expect(await vault.getUserTokenBalance(lp.address, tokens.MKR.address)).to.equal((0.8e18).toString());
    });

    it('fails if withdrawing from user balance with insufficient balance', async () => {
      await vault.connect(lp).deposit(tokens.DAI.address, BigNumber.from((0.1e18).toString()).sub(1), lp.address);
      await vault.connect(lp).deposit(tokens.MKR.address, (0.2e18).toString(), lp.address);

      await expect(
        tokenizer.connect(lp).joinPool((10e18).toString(), [(0.1e18).toString(), (0.2e18).toString()], false)
      ).to.be.revertedWith('ERR_SUB_UNDERFLOW');
    });
  });

  describe('exiting', () => {
    beforeEach(async () => {
      await tokenizer
        .connect(lp)
        .initialize(
          (100e18).toString(),
          [tokens.DAI.address, tokens.MKR.address],
          [(1e18).toString(), (2e18).toString()]
        );
    });

    it('takes BPT in return', async () => {
      const previousBPT = await tokenizer.balanceOf(lp.address);

      // By returning 10% of the current BTP, an LP gets in return 10% of the current token balance
      await tokenizer.connect(lp).exitPool((10e18).toString(), [0, 0], true);

      const newBPT = await tokenizer.balanceOf(lp.address);
      expect(newBPT.sub(previousBPT)).to.equal((-10e18).toString());
    });

    it('fails if minimum amounts are not enough', async () => {
      await expect(
        tokenizer
          .connect(lp)
          .exitPool((10e18).toString(), [BigNumber.from((0.1e18).toString()).add(1), (0.2e18).toString()], true)
      ).to.be.revertedWith('NOT EXITING ENOUGH');

      await expect(
        tokenizer
          .connect(lp)
          .exitPool((10e18).toString(), [(0.1e18).toString(), BigNumber.from((0.2e18).toString()).add(1)], true)
      ).to.be.revertedWith('NOT EXITING ENOUGH');
    });

    it('all tokens due are pushed', async () => {
      await expectBalanceChange(() => tokenizer.connect(lp).exitPool((10e18).toString(), [0, 0], true), lp, tokens, {
        DAI: 0.1e18,
        MKR: 0.2e18,
      });
    });

    it('fails if not requesting all tokens', async () => {
      await expect(tokenizer.connect(lp).exitPool((10e18).toString(), [(0.1e18).toString()], true)).to.be.revertedWith(
        'Tokens and amounts length mismatch'
      );
    });

    it('fails if requesting extra tokens', async () => {
      await expect(
        tokenizer
          .connect(lp)
          .exitPool((10e18).toString(), [(0.1e18).toString(), (0.2e18).toString(), (0.3e18).toString()], true)
      ).to.be.revertedWith('Tokens and amounts length mismatch');
    });

    it('can deposit into user balance', async () => {
      await expectBalanceChange(
        () => tokenizer.connect(lp).exitPool((10e18).toString(), [0, 0], false),
        lp,
        tokens,
        {}
      );

      expect(await vault.getUserTokenBalance(lp.address, tokens.DAI.address)).to.equal((0.1e18).toString());
      expect(await vault.getUserTokenBalance(lp.address, tokens.MKR.address)).to.equal((0.2e18).toString());
    });
  });

  describe('draining', () => {
    beforeEach(async () => {
      await tokenizer
        .connect(lp)
        .initialize(
          (100e18).toString(),
          [tokens.DAI.address, tokens.MKR.address],
          [(1e18).toString(), (2e18).toString()]
        );
    });

    it('pools can be fully exited', async () => {
      await tokenizer.connect(lp).exitPool((100e18).toString(), [0, 0], true);

      expect(await tokenizer.totalSupply()).to.equal(0);
      expect(await vault.getPoolTokens(poolId)).to.have.members([]);
    });

    it('drained pools cannot be rejoined', async () => {
      await tokenizer.connect(lp).exitPool((100e18).toString(), [0, 0], true);
      await expect(
        tokenizer.connect(lp).joinPool((10e18).toString(), [(0.1e18).toString(), (0.2e18).toString()], true)
      ).to.be.revertedWith('ERR_DIV_ZERO');
    });
  });
});
