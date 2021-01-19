import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract, ContractFunction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy } from '../../../scripts/helpers/deploy';
import { deployPoolFromFactory, SimplifiedQuotePool } from '../../../scripts/helpers/pools';
import { deployTokens, TokenList } from '../../helpers/tokens';
import { MAX_UINT128, MAX_UINT256, ZERO_ADDRESS } from '../../helpers/constants';
import { expectBalanceChange } from '../../helpers/tokenBalance';
import { FIXED_POINT_SCALING, toFixedPoint } from '../../../scripts/helpers/fixedPoint';
import { calculateInvariant } from '../../helpers/math/weightedProduct';

describe('ConstantProductPool', function () {
  let admin: SignerWithAddress;
  let creator: SignerWithAddress;
  let lp: SignerWithAddress;
  let trader: SignerWithAddress;
  let beneficiary: SignerWithAddress;
  let feeSetter: SignerWithAddress;
  let other: SignerWithAddress;

  let authorizer: Contract;
  let vault: Contract;
  let tokens: TokenList = {};

  const initialBPT = (90e18).toString();

  let poolTokens: string[];
  let poolInitialBalances: BigNumber[];
  let poolWeights: BigNumber[];
  let poolSwapFee: BigNumber;

  let callDeployPool: () => Promise<Contract>;

  before(async function () {
    [, admin, creator, lp, trader, beneficiary, feeSetter, other] = await ethers.getSigners();
  });

  beforeEach(async function () {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address] });

    tokens = await deployTokens(['DAI', 'MKR', 'SNX', 'BAT'], [18, 18, 18, 18]);
    for (const symbol in tokens) {
      await tokens[symbol].mint(creator.address, (100e18).toString());
      await tokens[symbol].connect(creator).approve(vault.address, MAX_UINT256);

      await tokens[symbol].mint(lp.address, (200e18).toString());
      await tokens[symbol].connect(lp).approve(vault.address, MAX_UINT256);

      await tokens[symbol].mint(trader.address, (100e18).toString());
      await tokens[symbol].connect(trader).approve(vault.address, MAX_UINT256);
    }

    poolTokens = [tokens.DAI.address, tokens.MKR.address];
    poolInitialBalances = [0.9e18, 1.8e18].map((value) => BigNumber.from(value.toString()));
    poolWeights = [70, 30].map((value) => BigNumber.from(value.toString()));
    poolSwapFee = toFixedPoint(0.01);

    callDeployPool = () =>
      deployPoolFromFactory(vault, admin, 'ConstantProductPool', {
        from: creator,
        parameters: [initialBPT, poolTokens, poolInitialBalances, poolWeights, poolSwapFee],
      });
  });

  describe('creation via factory', async () => {
    it('creates a pool in the vault', async () => {
      const pool = await callDeployPool();

      expect(await pool.getVault()).to.equal(vault.address);

      const poolId = await pool.getPoolId();
      expect(await vault.getPool(poolId)).to.have.members([pool.address, SimplifiedQuotePool]);
    });

    it('grants initial BPT to the pool creator', async () => {
      const pool = await callDeployPool();

      expect(await pool.balanceOf(creator.address)).to.equal(initialBPT);
    });

    it('adds tokens to pool', async () => {
      const pool = await callDeployPool();
      const poolId = await pool.getPoolId();

      expect(await vault.getPoolTokens(poolId)).to.have.members(poolTokens);
      expect(await vault.getPoolTokenBalances(poolId, poolTokens)).to.deep.equal(poolInitialBalances);
    });

    it('pulls tokens from the pool creator', async () => {
      await expectBalanceChange(() => callDeployPool(), tokens, [
        {
          account: creator,
          changes: { DAI: (-0.9e18).toString(), MKR: (-1.8e18).toString() },
        },
        { account: vault, changes: { DAI: (0.9e18).toString(), MKR: (1.8e18).toString() } },
      ]);
    });

    it('adds tokens to pool', async () => {
      const pool = await callDeployPool();
      const poolId = await pool.getPoolId();

      expect(await vault.getPoolTokens(poolId)).to.have.members(poolTokens);
      expect(await vault.getPoolTokenBalances(poolId, poolTokens)).to.deep.equal(poolInitialBalances);
    });

    it('sets token weights', async () => {
      const pool = await callDeployPool();
      expect(await pool.getWeights(poolTokens)).to.deep.equal(poolWeights);
    });

    it('sets swap fee', async () => {
      const pool = await callDeployPool();
      expect(await pool.getSwapFee()).to.equal(poolSwapFee);
    });

    it("reverts if the number of tokens and amounts don't match", async () => {
      await expect(
        deployPoolFromFactory(vault, admin, 'ConstantProductPool', {
          from: creator,
          parameters: [initialBPT, poolTokens, poolInitialBalances.slice(1), poolWeights, poolSwapFee],
        })
      ).to.be.revertedWith('Create2: Failed on deploy');
    });

    it("reverts if the number of tokens and weights don't match", async () => {
      await expect(
        deployPoolFromFactory(vault, admin, 'ConstantProductPool', {
          from: creator,
          parameters: [initialBPT, poolTokens, poolInitialBalances, poolWeights.slice(1), poolSwapFee],
        })
      ).to.be.revertedWith('Create2: Failed on deploy');
    });

    it('reverts if there is a single token', async () => {
      await expect(
        deployPoolFromFactory(vault, admin, 'ConstantProductPool', {
          from: creator,
          parameters: [
            initialBPT,
            poolTokens.slice(0, 1),
            poolInitialBalances.slice(0, 1),
            poolWeights.slice(0, 1),
            poolSwapFee,
          ],
        })
      ).to.be.revertedWith('Create2: Failed on deploy');
    });

    it('reverts if there are repeated tokens', async () => {
      await expect(
        deployPoolFromFactory(vault, admin, 'ConstantProductPool', {
          from: creator,
          parameters: [
            initialBPT,
            new Array(poolTokens.length).fill(poolTokens[0]),
            poolInitialBalances,
            poolWeights,
            poolSwapFee,
          ],
        })
      ).to.be.revertedWith('Create2: Failed on deploy');
    });

    it('reverts if there are too many tokens', async () => {
      // The maximum number of tokens is 16

      const manyTokens = await deployTokens(
        [
          'TK1',
          'TK2',
          'TK3',
          'TK4',
          'TK5',
          'TK6',
          'TK7',
          'TK8',
          'TK9',
          'TK10',
          'TK11',
          'TK12',
          'TK13',
          'TK14',
          'TK15',
          'TK16',
          'TK17',
        ],
        [18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18]
      );

      const manyTokenAddresses = [];
      for (const symbol in manyTokens) {
        manyTokenAddresses.push(manyTokens[symbol].address);
      }

      await expect(
        deployPoolFromFactory(vault, admin, 'ConstantProductPool', {
          from: creator,
          parameters: [
            initialBPT,
            manyTokenAddresses,
            new Array(17).fill(100),
            new Array(17).fill(toFixedPoint(1)),
            poolSwapFee,
          ],
        })
      ).to.be.revertedWith('Create2: Failed on deploy');
    });

    it('reverts if the swap fee is too high', async () => {
      await expect(
        deployPoolFromFactory(vault, admin, 'ConstantProductPool', {
          from: creator,
          parameters: [initialBPT, poolTokens, poolInitialBalances, poolWeights, toFixedPoint(0.1).add(1)],
        })
      ).to.be.revertedWith('Create2: Failed on deploy');
    });

    it('sets the name', async () => {
      const pool = await callDeployPool();

      expect(await pool.name()).to.equal('Balancer Pool Token');
    });

    it('sets the symbol', async () => {
      const pool = await callDeployPool();

      expect(await pool.symbol()).to.equal('BPT');
    });

    it('sets the decimals', async () => {
      const pool = await callDeployPool();

      expect(await pool.decimals()).to.equal(18);
    });
  });

  context('with pool', () => {
    let pool: Contract;
    let poolId: string;

    beforeEach(async () => {
      pool = await callDeployPool();
      poolId = await pool.getPoolId();
    });

    describe('joining', () => {
      it('grants BPT in return', async () => {
        const previousBPT = await pool.balanceOf(lp.address);

        // To get 10% of the current BPT, an LP needs to supply 10% of the current token balance
        await pool
          .connect(lp)
          .joinPool((10e18).toString(), [(0.1e18).toString(), (0.2e18).toString()], true, lp.address);

        const newBPT = await pool.balanceOf(lp.address);
        expect(newBPT.sub(previousBPT)).to.equal((10e18).toString());
      });

      it('grants BPT to specified beneficiary', async () => {
        const previousBPT = await pool.balanceOf(lp.address);

        // To get 10% of the current BPT, an LP needs to supply 10% of the current token balance
        await pool
          .connect(lp)
          .joinPool((10e18).toString(), [(0.1e18).toString(), (0.2e18).toString()], true, lp.address);

        const newBPT = await pool.balanceOf(lp.address);
        expect(newBPT.sub(previousBPT)).to.equal((10e18).toString());
      });

      it('fails if maximum amounts are not enough', async () => {
        await expect(
          pool
            .connect(lp)
            .joinPool(
              (10e18).toString(),
              [BigNumber.from((0.1e18).toString()).sub(1), (0.2e18).toString()],
              true,
              lp.address
            )
        ).to.be.revertedWith('ERR_LIMIT_IN');

        await expect(
          pool
            .connect(lp)
            .joinPool(
              (10e18).toString(),
              [(0.1e18).toString(), BigNumber.from((0.2e18).toString()).sub(1)],
              true,
              lp.address
            )
        ).to.be.revertedWith('ERR_LIMIT_IN');
      });

      it('only the required tokens are pulled', async () => {
        await expectBalanceChange(
          () =>
            pool.connect(lp).joinPool((10e18).toString(), [(10e18).toString(), (10e18).toString()], true, lp.address),
          tokens,
          { account: lp, changes: { DAI: -0.1e18, MKR: -0.2e18 } }
        );
      });

      it('fails if not supplying all tokens', async () => {
        await expect(
          pool.connect(lp).joinPool((10e18).toString(), [(0.1e18).toString()], [(0.1e18).toString()], lp.address)
        ).to.be.revertedWith('Tokens and amounts length mismatch');
      });

      it('fails if supplying extra tokens', async () => {
        await expect(
          pool
            .connect(lp)
            .joinPool(
              (10e18).toString(),
              [(0.1e18).toString(), (0.2e18).toString(), (0.3e18).toString()],
              true,
              lp.address
            )
        ).to.be.revertedWith('Tokens and amounts length mismatch');
      });

      it('can withdraw from user balance', async () => {
        await vault.connect(lp).deposit(tokens.DAI.address, (1e18).toString(), lp.address);
        await vault.connect(lp).deposit(tokens.MKR.address, (1e18).toString(), lp.address);

        await expectBalanceChange(
          () =>
            pool
              .connect(lp)
              .joinPool((10e18).toString(), [(0.1e18).toString(), (0.2e18).toString()], false, lp.address),
          tokens,
          { account: lp }
        );

        expect(await vault.getUserTokenBalance(lp.address, tokens.DAI.address)).to.equal((0.9e18).toString());
        expect(await vault.getUserTokenBalance(lp.address, tokens.MKR.address)).to.equal((0.8e18).toString());
      });

      it('transfers missing tokens if user balance is not enough', async () => {
        await vault.connect(lp).deposit(tokens.DAI.address, BigNumber.from((0.1e18).toString()).sub(1), lp.address);
        await vault.connect(lp).deposit(tokens.MKR.address, (0.2e18).toString(), lp.address);

        await expectBalanceChange(
          () =>
            pool
              .connect(lp)
              .joinPool((10e18).toString(), [(0.1e18).toString(), (0.2e18).toString()], false, lp.address),
          tokens,
          { account: lp, changes: { DAI: -1 } }
        );
      });
    });

    describe('joining & swapping', () => {
      it('grants BPT for exact tokens', async () => {
        const previousBPT = await pool.balanceOf(lp.address);
        const previousTokenBalance = await tokens.MKR.balanceOf(lp.address);

        await pool
          .connect(lp)
          .joinPoolExactTokensInForBPTOut((1e18).toString(), [0, (0.1e18).toString()], true, lp.address);

        const newBPT = await pool.balanceOf(lp.address);
        expect(newBPT.sub(previousBPT)).to.be.at.least((1.4616e18).toString());
        expect(newBPT.sub(previousBPT)).to.be.at.most((1.46161e18).toString());

        const newTokenBalance = await tokens.MKR.balanceOf(lp.address);
        expect(newTokenBalance.sub(previousTokenBalance)).to.equal((-0.1e18).toString());
      });

      it('grants exact BPT for tokens', async () => {
        const previousBPT = await pool.balanceOf(lp.address);
        const previousTokenBalance = await tokens.MKR.balanceOf(lp.address);

        await pool
          .connect(lp)
          .joinPoolTokenInForExactBPTOut(
            (1.4616e18).toString(),
            tokens.MKR.address,
            (0.15e18).toString(),
            true,
            lp.address
          );

        const newBPT = await pool.balanceOf(lp.address);
        expect(newBPT.sub(previousBPT)).to.equal((1.4616e18).toString());

        const newTokenBalance = await tokens.MKR.balanceOf(lp.address);
        expect(newTokenBalance.sub(previousTokenBalance)).to.be.at.least((-0.1e18).toString());
        expect(newTokenBalance.sub(previousTokenBalance)).to.be.at.most((-0.099e18).toString());
      });
    });

    describe('exiting', () => {
      beforeEach(async () => {
        // The LP joins and gets 10e18 BPT
        await pool
          .connect(lp)
          .joinPool((10e18).toString(), [(0.1e18).toString(), (0.2e18).toString()], true, lp.address);

        expect(await pool.totalSupply()).to.equal((100e18).toString());
        expect(await vault.getPoolTokenBalances(poolId, poolTokens)).to.deep.equal([
          BigNumber.from((1e18).toString()),
          BigNumber.from((2e18).toString()),
        ]);
      });

      it('takes BPT in return', async () => {
        const previousBPT = await pool.balanceOf(lp.address);

        await pool.connect(lp).exitPool((10e18).toString(), [0, 0], true, lp.address);

        const newBPT = await pool.balanceOf(lp.address);
        expect(newBPT.sub(previousBPT)).to.equal((-10e18).toString());
      });

      it('fails if minimum amounts are not enough', async () => {
        await expect(
          pool
            .connect(lp)
            .exitPool(
              (10e18).toString(),
              [BigNumber.from((0.1e18).toString()).add(1), (0.2e18).toString()],
              true,
              lp.address
            )
        ).to.be.revertedWith('NOT EXITING ENOUGH');

        await expect(
          pool
            .connect(lp)
            .exitPool(
              (10e18).toString(),
              [(0.1e18).toString(), BigNumber.from((0.2e18).toString()).add(1)],
              true,
              lp.address
            )
        ).to.be.revertedWith('NOT EXITING ENOUGH');
      });

      it('fails if not requesting all tokens', async () => {
        await expect(
          pool.connect(lp).exitPool((10e18).toString(), [(0.1e18).toString()], true, lp.address)
        ).to.be.revertedWith('Tokens and amounts length mismatch');
      });

      it('fails if exiting with excess BPT', async () => {
        await expect(
          pool.connect(lp).exitPool(BigNumber.from((10e18).toString()).add(1), [0, 0], true, lp.address)
        ).to.be.revertedWith('ERR_INSUFFICIENT_BAL');
      });

      it('all tokens due are pushed', async () => {
        await expectBalanceChange(
          () => pool.connect(lp).exitPool((10e18).toString(), [0, 0], true, lp.address),
          tokens,
          { account: lp, changes: { DAI: 0.1e18, MKR: 0.2e18 } }
        );
      });

      it('all tokens due are pushed to a specified beneficiary', async () => {
        await expectBalanceChange(
          () => pool.connect(lp).exitPool((10e18).toString(), [0, 0], true, beneficiary.address),
          tokens,
          { account: beneficiary, changes: { DAI: 0.1e18, MKR: 0.2e18 } }
        );
      });

      context('with protocol withdraw fees', () => {
        const protocolWithdrawFee = 0.01;

        beforeEach(async () => {
          await authorizer
            .connect(admin)
            .grantRole(await authorizer.SET_PROTOCOL_WITHDRAW_FEE_ROLE(), feeSetter.address);
          await vault.connect(feeSetter).setProtocolWithdrawFee(toFixedPoint(protocolWithdrawFee));
        });

        it('tokens minus fee are pushed', async () => {
          await expectBalanceChange(
            () => pool.connect(lp).exitPool((10e18).toString(), [0, 0], true, lp.address),
            tokens,
            {
              account: lp,
              changes: {
                DAI: 0.1e18 * (1 - protocolWithdrawFee),
                MKR: 0.2e18 * (1 - protocolWithdrawFee),
              },
            }
          );
        });
      });

      it('can deposit into user balance', async () => {
        await expectBalanceChange(
          () => pool.connect(lp).exitPool((10e18).toString(), [0, 0], false, lp.address),
          tokens,
          { account: lp }
        );
      });

      it('fails if requesting extra tokens', async () => {
        await expect(
          pool
            .connect(lp)
            .exitPool(
              (10e18).toString(),
              [(0.1e18).toString(), (0.2e18).toString(), (0.3e18).toString()],
              true,
              lp.address
            )
        ).to.be.revertedWith('Tokens and amounts length mismatch');
      });

      it('can deposit into user balance', async () => {
        await expectBalanceChange(
          () => pool.connect(lp).exitPool((10e18).toString(), [0, 0], false, lp.address),
          tokens,
          { account: lp }
        );

        expect(await vault.getUserTokenBalance(lp.address, tokens.DAI.address)).to.equal((0.1e18).toString());
        expect(await vault.getUserTokenBalance(lp.address, tokens.MKR.address)).to.equal((0.2e18).toString());
      });

      it("can deposit into a beneficiary's user balance", async () => {
        await expectBalanceChange(
          () => pool.connect(lp).exitPool((10e18).toString(), [0, 0], false, beneficiary.address),
          tokens,
          { account: beneficiary }
        );

        expect(await vault.getUserTokenBalance(beneficiary.address, tokens.DAI.address)).to.equal((0.1e18).toString());
        expect(await vault.getUserTokenBalance(beneficiary.address, tokens.MKR.address)).to.equal((0.2e18).toString());
      });
    });

    describe('exiting & swapping', () => {
      beforeEach(async () => {
        // The LP joins and gets 10e18 BPT
        await pool
          .connect(lp)
          .joinPool((10e18).toString(), [(0.1e18).toString(), (0.2e18).toString()], true, lp.address);

        expect(await pool.totalSupply()).to.equal((100e18).toString());
        expect(await vault.getPoolTokenBalances(poolId, poolTokens)).to.deep.equal([
          BigNumber.from((1e18).toString()),
          BigNumber.from((2e18).toString()),
        ]);
      });

      it('takes exact BPT for tokens', async () => {
        const previousBPT = await pool.balanceOf(lp.address);
        const previousTokenBalance = await tokens.MKR.balanceOf(lp.address);

        await pool
          .connect(lp)
          .exitPoolExactBPTInForTokenOut(
            (1.54e18).toString(),
            tokens.MKR.address,
            (0.099e18).toString(),
            true,
            lp.address
          );

        const newBPT = await pool.balanceOf(lp.address);
        expect(newBPT.sub(previousBPT)).to.equal((-1.54e18).toString());

        const newTokenBalance = await tokens.MKR.balanceOf(lp.address);
        expect(newTokenBalance.sub(previousTokenBalance)).to.be.at.least((0.099e18).toString());
        expect(newTokenBalance.sub(previousTokenBalance)).to.be.at.most((0.105e18).toString());
      });

      it('takes BPT for exact tokens', async () => {
        const previousBPT = await pool.balanceOf(lp.address);
        const previousTokenBalance = await tokens.MKR.balanceOf(lp.address);

        await pool
          .connect(lp)
          .exitPoolBPTInForExactTokensOut((2e18).toString(), [0, (0.1e18).toString()], true, lp.address);

        const newBPT = await pool.balanceOf(lp.address);
        expect(newBPT.sub(previousBPT)).to.be.at.least((-1.55e18).toString());
        expect(newBPT.sub(previousBPT)).to.be.at.most((-1.53e18).toString());

        const newTokenBalance = await tokens.MKR.balanceOf(lp.address);
        expect(newTokenBalance.sub(previousTokenBalance)).to.equal((0.1e18).toString());
      });
    });

    describe('joining & swapping & exiting', () => {
      it('cannot exit with more tokens than joined', async () => {
        const previousBPT = await pool.balanceOf(lp.address);
        const previousTokenBalance = await tokens.MKR.balanceOf(lp.address);

        await pool
          .connect(lp)
          .joinPoolExactTokensInForBPTOut((1e18).toString(), [0, (0.1e18).toString()], true, lp.address);

        const newBPT = await pool.balanceOf(lp.address);
        const obtainedBPT = newBPT.sub(previousBPT);

        await pool.connect(lp).exitPoolExactBPTInForTokenOut(obtainedBPT, tokens.MKR.address, 0, true, lp.address);

        const newTokenBalance = await tokens.MKR.balanceOf(lp.address);

        expect(newTokenBalance.sub(previousTokenBalance)).to.be.at.most(0);
      });
    });

    describe('draining', () => {
      it('pools can be fully exited', async () => {
        await pool.connect(creator).exitPool(initialBPT, [0, 0], true, creator.address);

        expect(await pool.totalSupply()).to.equal(0);

        // The tokens are not unregistered from the Pool
        expect(await vault.getPoolTokens(poolId)).to.not.be.empty;
        expect(await vault.getPoolTokens(poolId)).to.have.members([tokens.DAI.address, tokens.MKR.address]);
      });

      it('drained pools cannot be rejoined', async () => {
        await pool.connect(creator).exitPool(initialBPT, [0, 0], true, creator.address);

        await expect(
          pool.connect(lp).joinPool((10e18).toString(), [(0.1e18).toString(), (0.2e18).toString()], true, lp.address)
        ).to.be.revertedWith('ERR_ZERO_LIQUIDITY');
      });
    });
  });

  describe('quotes', () => {
    let pool: Contract;
    let poolId: string;

    context('with two tokens', () => {
      beforeEach(async () => {
        pool = await deployPoolFromFactory(vault, admin, 'ConstantProductPool', {
          from: lp,
          parameters: [
            initialBPT,
            [tokens.DAI.address, tokens.MKR.address],
            [100, 100], // These are not relevant since we're asking for quotes and not swapping via the vault
            [toFixedPoint(8), toFixedPoint(2)],
            toFixedPoint(0.1),
          ],
        });

        poolId = await pool.getPoolId();
      });

      it('quotes amount out', async () => {
        const result = await pool.quoteOutGivenIn(
          {
            poolId,
            from: other.address,
            to: other.address,
            tokenIn: tokens.DAI.address,
            tokenOut: tokens.MKR.address,
            amountIn: (16.6e18).toString(), // ~15e18 + 10% fee
            userData: '0x',
          },
          (100e18).toString(), // tokenInBalance
          (200e18).toString() // tokenOutBalance
        );

        expect(result).to.be.at.least((85.4e18).toString());
        expect(result).to.be.at.most((85.5e18).toString());
      });

      it('quotes amount in', async () => {
        const result = await pool.quoteInGivenOut(
          {
            poolId,
            from: other.address,
            to: other.address,
            tokenIn: tokens.DAI.address,
            tokenOut: tokens.MKR.address,
            amountOut: (85.4e18).toString(),
            userData: '0x',
          },
          (100e18).toString(), // tokenInBalance
          (200e18).toString() // tokenOutBalance
        );

        expect(result).to.be.at.least((16.5e18).toString());
        expect(result).to.be.at.most((16.6e18).toString());
      });

      it('reverts if token in is not in the pool', async () => {
        await expect(
          pool.quoteOutGivenIn(
            {
              poolId,
              from: other.address,
              to: other.address,
              tokenIn: tokens.BAT.address,
              tokenOut: tokens.MKR.address,
              amountIn: 100,
              userData: '0x',
            },
            100,
            200
          )
        ).to.be.revertedWith('ERR_INVALID_TOKEN');

        await expect(
          pool.quoteInGivenOut(
            {
              poolId,
              from: other.address,
              to: other.address,
              tokenIn: tokens.BAT.address,
              tokenOut: tokens.MKR.address,
              amountOut: 100,
              userData: '0x',
            },
            100,
            200
          )
        ).to.be.revertedWith('ERR_INVALID_TOKEN');
      });

      it('reverts if token out is not in the pool', async () => {
        await expect(
          pool.quoteOutGivenIn(
            {
              poolId,
              from: other.address,
              to: other.address,
              tokenIn: tokens.DAI.address,
              tokenOut: tokens.BAT.address,
              amountIn: 100,
              userData: '0x',
            },
            100,
            200
          )
        ).to.be.revertedWith('ERR_INVALID_TOKEN');

        await expect(
          pool.quoteInGivenOut(
            {
              poolId,
              from: other.address,
              to: other.address,
              tokenIn: tokens.DAI.address,
              tokenOut: tokens.BAT.address,
              amountOut: 100,
              userData: '0x',
            },
            100,
            200
          )
        ).to.be.revertedWith('ERR_INVALID_TOKEN');
      });
    });

    context('with three tokens', () => {
      beforeEach(async () => {
        pool = await deployPoolFromFactory(vault, admin, 'ConstantProductPool', {
          from: lp,
          parameters: [
            initialBPT,
            [tokens.DAI.address, tokens.MKR.address, tokens.SNX.address],
            [100, 100, 100], // These are not relevant since we're asking for quotes and not swapping via the vault
            [toFixedPoint(8), toFixedPoint(2), toFixedPoint(3)],
            toFixedPoint(0.1),
          ],
        });

        poolId = await pool.getPoolId();
      });

      it('quotes amount out', async () => {
        const result = await pool.quoteOutGivenIn(
          {
            poolId,
            from: other.address,
            to: other.address,
            tokenIn: tokens.DAI.address,
            tokenOut: tokens.MKR.address,
            amountIn: (16.6e18).toString(), // ~15e18 + 10% fee
            userData: '0x',
          },
          (100e18).toString(), // tokenInBalance
          (200e18).toString() // tokenOutBalance
        );

        expect(result).to.be.at.least((85.4e18).toString());
        expect(result).to.be.at.most((85.5e18).toString());
      });

      it('quotes amount in', async () => {
        const result = await pool.quoteInGivenOut(
          {
            poolId,
            from: other.address,
            to: other.address,
            tokenIn: tokens.DAI.address,
            tokenOut: tokens.MKR.address,
            amountOut: (85.4e18).toString(),
            userData: '0x',
          },
          (100e18).toString(), // tokenInBalance
          (200e18).toString() // tokenOutBalance
        );

        expect(result).to.be.at.least((16.5e18).toString());
        expect(result).to.be.at.most((16.6e18).toString());
      });

      it('reverts if token in is not in the pool', async () => {
        await expect(
          pool.quoteOutGivenIn(
            {
              poolId,
              from: other.address,
              to: other.address,
              tokenIn: tokens.BAT.address,
              tokenOut: tokens.MKR.address,
              amountIn: 100,
              userData: '0x',
            },
            100,
            200
          )
        ).to.be.revertedWith('ERR_INVALID_TOKEN');

        await expect(
          pool.quoteInGivenOut(
            {
              poolId,
              from: other.address,
              to: other.address,
              tokenIn: tokens.BAT.address,
              tokenOut: tokens.MKR.address,
              amountOut: 100,
              userData: '0x',
            },
            100,
            200
          )
        ).to.be.revertedWith('ERR_INVALID_TOKEN');
      });

      it('reverts if token out is not in the pool', async () => {
        await expect(
          pool.quoteOutGivenIn(
            {
              poolId,
              from: other.address,
              to: other.address,
              tokenIn: tokens.DAI.address,
              tokenOut: tokens.BAT.address,
              amountIn: 100,
              userData: '0x',
            },
            100,
            200
          )
        ).to.be.revertedWith('ERR_INVALID_TOKEN');

        await expect(
          pool.quoteInGivenOut(
            {
              poolId,
              from: other.address,
              to: other.address,
              tokenIn: tokens.DAI.address,
              tokenOut: tokens.BAT.address,
              amountOut: 100,
              userData: '0x',
            },
            100,
            200
          )
        ).to.be.revertedWith('ERR_INVALID_TOKEN');
      });
    });
  });

  /////////Temporary pool creation with mock vault
  const callDeployPoolWithMockVault = async (vault: Contract) => {
    const name = 'Balancer Pool Token';
    const symbol = 'BPT';
    return deploy('ConstantProductPool', {
      args: [
        vault.address,
        name,
        symbol,
        0, //Initial BPT is always cero
        poolTokens,
        ['0', '0'], //Initial Balances are empty
        admin.address,
        poolWeights,
        poolSwapFee,
      ],
    });
  };
  //////////Temporary

  const INIT = 0;
  const EXACT_TOKENS_IN_FOR_BPT_OUT = 1;

  const encodeJoinInitialUserData = (): string => {
    return ethers.utils.defaultAbiCoder.encode(['uint256'], [INIT]);
  };
  const encodeJoinExactTokensInForBPTOutUserData = (minimumBPT: string): string => {
    return ethers.utils.defaultAbiCoder.encode(['uint256', 'uint256'], [EXACT_TOKENS_IN_FOR_BPT_OUT, minimumBPT]);
  };

  describe.only('join hook', () => {
    const protocolSwapFee = toFixedPoint(0);
    const emptyBalances = (poolInitialBalances = [0, 0].map((value) => BigNumber.from(value.toString())));

    let vault: Contract;
    let pool: Contract;
    let poolId: string;

    beforeEach(async function () {
      vault = await deploy('MockVault', { args: [] });
      pool = await callDeployPoolWithMockVault(vault);
      poolId = await pool.getPoolId();
    });

    it('fails if caller is not the vault', async () => {
      await expect(
        pool
          .connect(lp)
          .onJoinPool(poolId, emptyBalances, lp.address, other.address, emptyBalances, protocolSwapFee, '0x')
      ).to.be.revertedWith('ERR_CALLER_NOT_VAULT');
    });

    it('fails if wrong pool id', async () => {
      await expect(
        vault
          .connect(lp)
          .joinPool(
            pool.address,
            '0x0000000000000000000000000000000000000000000000000000000000000000',
            other.address,
            poolTokens,
            emptyBalances,
            false,
            '0x'
          )
      ).to.be.revertedWith('INVALID_POOL_ID');
    });

    it('fails if no user data', async () => {
      await expect(
        vault.connect(lp).joinPool(pool.address, poolId, other.address, poolTokens, emptyBalances, false, '0x')
      ).to.be.be.revertedWith('Transaction reverted without a reason');
    });

    it('fails if wrong user data', async () => {
      const wrongUserData = ethers.utils.defaultAbiCoder.encode(['address'], [lp.address]);

      await expect(
        vault.connect(lp).joinPool(pool.address, poolId, other.address, poolTokens, emptyBalances, false, wrongUserData)
      ).to.be.be.revertedWith('Transaction reverted without a reason');
    });

    context('intialization', () => {
      let initialBalances: BigNumber[];
      let initialUserData: string;

      beforeEach(async () => {
        initialBalances = [0.9e18, 1.8e18].map((value) => BigNumber.from(value.toString()));
        initialUserData = encodeJoinInitialUserData();
      });
      it('grants the invariant amount of BPT', async () => {
        const previousBPT = await pool.balanceOf(other.address);

        const invariant = calculateInvariant(
          initialBalances.map((value) => value.toString()),
          poolWeights.map((value) => value.toString())
        );

        await vault
          .connect(creator)
          .joinPool(pool.address, poolId, other.address, poolTokens, initialBalances, false, initialUserData);

        //Balances should be the same as initial ones
        expect(await vault.getPoolCurrentBalances()).to.deep.equal(
          initialBalances.map((value) => BigNumber.from(value.toString()))
        );

        //Initial balances should equal invariant
        const newBPT = await pool.balanceOf(other.address);
        expect(newBPT.sub(previousBPT)).to.be.at.least(invariant.sub(1).toFixed(0));
        expect(newBPT.sub(previousBPT)).to.be.at.most(invariant.add(1).toFixed(0));
      });

      it('fails if already intialized', async () => {
        await vault
          .connect(creator)
          .joinPool(pool.address, poolId, other.address, poolTokens, initialBalances, false, initialUserData);

        await expect(
          vault
            .connect(creator)
            .joinPool(pool.address, poolId, other.address, poolTokens, initialBalances, false, initialUserData)
        ).to.be.be.revertedWith('ERR_ALREADY_INITIALIZED');
      });
    });

    context('join exact tokens in for BPT out', () => {
      it('fails if not intialized', async () => {
        const joinUserData = encodeJoinExactTokensInForBPTOutUserData('0');
        await expect(
          vault
            .connect(creator)
            .joinPool(pool.address, poolId, other.address, poolTokens, emptyBalances, false, joinUserData)
        ).to.be.be.revertedWith('ERR_UNINITIALIZED');
      });

      context('initialized', () => {
        beforeEach(async () => {
          const initialBalances = [0.9e18, 1.8e18].map((value) => BigNumber.from(value.toString()));
          const initialUserData = encodeJoinInitialUserData();
          await vault
            .connect(creator)
            .joinPool(pool.address, poolId, other.address, poolTokens, initialBalances, false, initialUserData);
        });

        it('grants BPT for exact tokens', async () => {
          const previousBPT = await pool.balanceOf(lp.address);

          const minimumBPT = (0.01e18).toString();
          const joinUserData = encodeJoinExactTokensInForBPTOutUserData(minimumBPT);
          const inBalances = [0, 0.1e18].map((value) => BigNumber.from(value.toString()));

          await vault
            .connect(lp)
            .joinPool(pool.address, poolId, lp.address, poolTokens, inBalances, false, joinUserData);

          const newBPT = await pool.balanceOf(lp.address);
          expect(newBPT.sub(previousBPT)).to.be.at.least((0.017e18).toString());
          expect(newBPT.sub(previousBPT)).to.be.at.most((0.018e18).toString());
        });

        it('fails if not enough BPT', async () => {
          const minimumBPT = (1e18).toString();
          const joinUserData = encodeJoinExactTokensInForBPTOutUserData(minimumBPT);
          const inBalances = [0, 0.1e18].map((value) => BigNumber.from(value.toString()));

          await expect(
            vault.connect(lp).joinPool(pool.address, poolId, lp.address, poolTokens, inBalances, false, joinUserData)
          ).to.be.be.revertedWith('ERR_BPT_OUT_MIN_AMOUNT');
        });
      });
    });
  });

  describe.only('exit hook', () => {
    let vault: Contract;
    let pool: Contract;
    let poolId: string;
    const EXACT_BPT_IN_FOR_ONE_TOKEN_OUT = 0;
    const EXACT_BPT_IN_FOR_ALL_TOKENS_OUT = 1;
    const BPT_IN_FOR_EXACT_TOKENS_OUT = 2;

    const protocolSwapFee = toFixedPoint(0);
    const emptyBalances = (poolInitialBalances = [0, 0].map((value) => BigNumber.from(value.toString())));

    const encodeExitExactBPTInForOneTokenOutUserData = (bptAmountIn: string, tokenIndex: number): string => {
      return ethers.utils.defaultAbiCoder.encode(
        ['uint256', 'uint256', 'uint256'],
        [EXACT_BPT_IN_FOR_ONE_TOKEN_OUT, bptAmountIn, tokenIndex]
      );
    };

    const encodeExitExactBPTInForAllTokensOutUserData = (bptAmountIn: string): string => {
      return ethers.utils.defaultAbiCoder.encode(
        ['uint256', 'uint256'],
        [EXACT_BPT_IN_FOR_ALL_TOKENS_OUT, bptAmountIn]
      );
    };

    const encodeExitBPTInForExactTokensOutUserData = (maxBPTAmountIn: string): string => {
      return ethers.utils.defaultAbiCoder.encode(['uint256', 'uint256'], [BPT_IN_FOR_EXACT_TOKENS_OUT, maxBPTAmountIn]);
    };

    // const encodeJoinUserData = (kind: ExitKind, minimumBPT: string): string => {
    //   return ethers.utils.defaultAbiCoder.encode(['uint256', 'uint256'], [kind, minimumBPT]);
    // };

    beforeEach(async function () {
      vault = await deploy('MockVault', { args: [] });
      pool = await callDeployPoolWithMockVault(vault);
      poolId = await pool.getPoolId();

      //Initialize
      const initialBalances = [0.9e18, 1.8e18].map((value) => BigNumber.from(value.toString()));
      const initialUserData = encodeJoinInitialUserData();
      await vault
        .connect(creator)
        .joinPool(pool.address, poolId, other.address, poolTokens, initialBalances, false, initialUserData);

      //Join
      const minimumBPT = (0.01e18).toString();
      const joinUserData = encodeJoinExactTokensInForBPTOutUserData(minimumBPT);
      const inBalances = [0, 0.1e18].map((value) => BigNumber.from(value.toString()));
      await vault.connect(lp).joinPool(pool.address, poolId, lp.address, poolTokens, inBalances, false, joinUserData);
    });

    it('fails if caller is not the vault', async () => {
      await expect(
        pool
          .connect(lp)
          .onExitPool(poolId, emptyBalances, lp.address, other.address, emptyBalances, protocolSwapFee, '0x')
      ).to.be.revertedWith('ERR_CALLER_NOT_VAULT');
    });

    it('fails if wrong pool id', async () => {
      await expect(
        vault
          .connect(lp)
          .exitPool(
            pool.address,
            '0x0000000000000000000000000000000000000000000000000000000000000000',
            other.address,
            poolTokens,
            emptyBalances,
            false,
            '0x'
          )
      ).to.be.revertedWith('INVALID_POOL_ID');
    });

    it('fails if no user data', async () => {
      await expect(
        vault.connect(lp).exitPool(pool.address, poolId, other.address, poolTokens, emptyBalances, false, '0x')
      ).to.be.be.revertedWith('Transaction reverted without a reason');
    });

    it('fails if wrong user data', async () => {
      const wrongUserData = ethers.utils.defaultAbiCoder.encode(['address'], [lp.address]);

      await expect(
        vault.connect(lp).exitPool(pool.address, poolId, other.address, poolTokens, emptyBalances, false, wrongUserData)
      ).to.be.be.revertedWith('Transaction reverted without a reason');
    });

    context('exit exact BPT in for one token out', () => {
      it('grants one token for exact bpt', async () => {
        const prevBPT = await pool.balanceOf(lp.address);
        const prevBalances = await vault.getPoolCurrentBalances();

        const tokenIndex = 0;
        const exitUserData = encodeExitExactBPTInForOneTokenOutUserData(prevBPT, tokenIndex);
        const minAmountsOut = [0.01e18, 0].map((value) => BigNumber.from(value.toString()));

        await vault
          .connect(lp)
          .exitPool(pool.address, poolId, lp.address, poolTokens, minAmountsOut, false, exitUserData);

        const newBalances = await vault.getPoolCurrentBalances();
        expect(prevBalances[tokenIndex].sub(newBalances[tokenIndex])).to.be.at.least((0.0204e18).toString());
        expect(prevBalances[tokenIndex].sub(newBalances[tokenIndex])).to.be.at.most((0.0205e18).toString());

        const newBPT = await pool.balanceOf(lp.address);
        expect(newBPT).to.be.equal((0).toString());
      });
    });

    context('exit exact BPT in for all tokens out', () => {
      it('grants all tokens for exact bpt', async () => {
        const prevBPT = await pool.balanceOf(lp.address);
        const prevBalances = await vault.getPoolCurrentBalances();

        const exitUserData = encodeExitExactBPTInForAllTokensOutUserData(prevBPT);
        const minAmountsOut = [0.01e18, 0.01e18].map((value) => BigNumber.from(value.toString()));

        await vault
          .connect(lp)
          .exitPool(pool.address, poolId, lp.address, poolTokens, minAmountsOut, false, exitUserData);

        const newBalances = await vault.getPoolCurrentBalances();
        expect(prevBalances[0].sub(newBalances[0])).to.be.at.least((0.014e18).toString());
        expect(prevBalances[0].sub(newBalances[0])).to.be.at.most((0.015e18).toString());

        expect(prevBalances[1].sub(newBalances[1])).to.be.at.least((0.03e18).toString());
        expect(prevBalances[1].sub(newBalances[1])).to.be.at.most((0.031e18).toString());

        const newBPT = await pool.balanceOf(lp.address);
        expect(newBPT).to.be.equal((0).toString());
      });
    });

    context('exit BPT in exact for tokens out', () => {
      it('grants exact tokens for bpt', async () => {
        const maxBPTAmountIn = await pool.balanceOf(lp.address);
        const prevBalances = await vault.getPoolCurrentBalances();

        const exitUserData = encodeExitBPTInForExactTokensOutUserData(maxBPTAmountIn);

        const amountsOut = [0.014e18, 0.03e18].map((value) => BigNumber.from(value.toString()));

        await vault.connect(lp).exitPool(pool.address, poolId, lp.address, poolTokens, amountsOut, false, exitUserData);

        const newBalances = await vault.getPoolCurrentBalances();
        expect(prevBalances[0].sub(newBalances[0])).to.be.equal((0.014e18).toString());
        expect(prevBalances[1].sub(newBalances[1])).to.be.equal((0.03e18).toString());

        const newBPT = await pool.balanceOf(lp.address);
        expect(newBPT).to.be.at.most((0.001e18).toString());
      });

      it('fails if more BTP needed', async () => {
        const maxBPTAmountIn = await pool.balanceOf(lp.address);

        const exitUserData = encodeExitBPTInForExactTokensOutUserData(maxBPTAmountIn);
        const amountsOut = [0.02e18, 0.04e18].map((value) => BigNumber.from(value.toString()));

        await expect(
          vault.connect(lp).exitPool(pool.address, poolId, lp.address, poolTokens, amountsOut, false, exitUserData)
        ).to.be.be.revertedWith('ERR_BPT_IN_MAX_AMOUNT');
      });
    });
  });

  describe('protocol swap fees', () => {
    let pool: Contract;
    let poolId: string;
    let initialBalances: BigNumber[];
    let tokenAddresses: string[];
    let tokenWeights: string[];

    const swapFee = toFixedPoint(0.05); // 5 %
    const protocolSwapFee = toFixedPoint(0.1); // 10 %

    beforeEach(async () => {
      //Set protocol swap fee in Vault
      await authorizer.connect(admin).grantRole(await authorizer.SET_PROTOCOL_SWAP_FEE_ROLE(), feeSetter.address);
      await vault.connect(feeSetter).setProtocolSwapFee(protocolSwapFee);

      initialBalances = [BigNumber.from((80e18).toString()), BigNumber.from((20e18).toString())];
      tokenAddresses = [tokens.DAI.address, tokens.MKR.address];
      tokenWeights = [(8e18).toString(), (2e18).toString()];

      pool = await deployPoolFromFactory(vault, admin, 'ConstantProductPool', {
        from: lp,
        parameters: [initialBPT, tokenAddresses, initialBalances, tokenWeights, swapFee],
      });

      poolId = await pool.getPoolId();

      // Grant some initial BPT to the LP
      await pool.connect(lp).joinPool((1e18).toString(), [MAX_UINT128, MAX_UINT128], true, lp.address);
    });

    it('joins and exits do not accumulate fees', async () => {
      await pool.connect(lp).joinPool((1e18).toString(), [MAX_UINT128, MAX_UINT128], true, lp.address);
      await pool.connect(lp).joinPool((4e18).toString(), [MAX_UINT128, MAX_UINT128], true, lp.address);

      await pool.connect(lp).exitPool((0.5e18).toString(), [0, 0], true, lp.address);
      await pool.connect(lp).exitPool((2.5e18).toString(), [0, 0], true, lp.address);

      await pool.connect(lp).joinPool((7e18).toString(), [MAX_UINT128, MAX_UINT128], true, lp.address);

      await pool.connect(lp).exitPool((5e18).toString(), [0, 0], true, lp.address);

      expect(await vault.getCollectedFeesByToken(tokens.DAI.address)).to.equal(0);
      expect(await vault.getCollectedFeesByToken(tokens.MKR.address)).to.equal(0);
    });

    context('with swap', () => {
      const inAmount = (10e18).toString();

      beforeEach(async () => {
        const swap = {
          poolId,
          amountIn: inAmount,
          tokenInIndex: 0, // send DAI, get MKR
          tokenOutIndex: 1,
          userData: '0x',
        };

        const funds = {
          sender: trader.address,
          recipient: trader.address,
          withdrawFromUserBalance: false,
          depositToUserBalance: false,
        };

        await vault.connect(trader).batchSwapGivenIn(ZERO_ADDRESS, '0x', [swap], tokenAddresses, funds);
      });

      async function assertProtocolSwapFeeIsCharged(payFeesAction: ContractFunction) {
        const previousBlockHash = (await ethers.provider.getBlock('latest')).hash;
        const paidTokenIndex = BigNumber.from(previousBlockHash).mod(tokenAddresses.length).toNumber();
        const notPaidTokenIndex = paidTokenIndex == 0 ? 1 : 0;

        await payFeesAction();

        const poolSwapFeeAmount = BigNumber.from(inAmount).mul(swapFee).div(FIXED_POINT_SCALING);
        const protocolSwapFeeAmount = poolSwapFeeAmount.mul(protocolSwapFee).div(FIXED_POINT_SCALING);

        let expectedPaidFees, error;
        if (paidTokenIndex == 0) {
          expectedPaidFees = protocolSwapFeeAmount;
          error = protocolSwapFeeAmount.div(1000);
        } else {
          // We approximate the fee amount paid in token out based on the price after the swap
          const finalBalances = await vault.getPoolTokenBalances(poolId, tokenAddresses);
          expectedPaidFees = await pool.quoteOutGivenIn(
            {
              poolId,
              from: other.address,
              to: other.address,
              tokenIn: tokens.DAI.address,
              tokenOut: tokens.MKR.address,
              amountIn: protocolSwapFeeAmount,
              userData: '0x',
            },
            finalBalances[0],
            finalBalances[1]
          );
          // Since the expected fees is an approximation, we expect a greater error
          error = expectedPaidFees.div(10);
        }

        const paidTokenFees = await vault.getCollectedFeesByToken(tokenAddresses[paidTokenIndex]);
        expect(paidTokenFees).be.at.least(expectedPaidFees.sub(error));
        expect(paidTokenFees).be.at.most(expectedPaidFees.add(error));

        const notPaidTokenFees = await vault.getCollectedFeesByToken(tokenAddresses[notPaidTokenIndex]);
        expect(notPaidTokenFees).to.equal(0);
      }

      it('pays swap protocol fees if requested', async () => {
        await assertProtocolSwapFeeIsCharged(() => pool.payProtocolFees());
      });

      it('pays swap protocol fees on join', async () => {
        await assertProtocolSwapFeeIsCharged(() =>
          pool.connect(lp).joinPool((1e18).toString(), [MAX_UINT128, MAX_UINT128], true, lp.address)
        );
      });

      it('pays swap protocol fees on joinswap exact tokens in', async () => {
        await assertProtocolSwapFeeIsCharged(() =>
          pool
            .connect(lp)
            .joinPoolExactTokensInForBPTOut(0, [(0.8e18).toString(), (0.2e18).toString()], true, lp.address)
        );
      });

      it('pays swap protocol fees on join exact bpt out', async () => {
        await assertProtocolSwapFeeIsCharged(() =>
          pool
            .connect(lp)
            .joinPoolTokenInForExactBPTOut((1e18).toString(), tokens.DAI.address, MAX_UINT128, true, lp.address)
        );
      });

      it('pays swap protocol fees on exit', async () => {
        await assertProtocolSwapFeeIsCharged(() =>
          pool.connect(lp).exitPool((1e18).toString(), [0, 0], true, lp.address)
        );
      });

      it('pays swap protocol fees on exit exact bpt in', async () => {
        await assertProtocolSwapFeeIsCharged(() =>
          pool.connect(lp).exitPoolExactBPTInForTokenOut((1e18).toString(), tokens.DAI.address, 0, true, lp.address)
        );
      });

      it('pays swap protocol fees on exit', async () => {
        await assertProtocolSwapFeeIsCharged(() =>
          pool.connect(lp).exitPoolBPTInForExactTokensOut(MAX_UINT128, [0, 0], true, lp.address)
        );
      });
    });
  });
});
