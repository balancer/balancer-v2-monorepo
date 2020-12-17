import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy } from '../../../scripts/helpers/deploy';
import { deployPoolFromFactory, TupleTS } from '../../../scripts/helpers/pools';
import { deployTokens, TokenList } from '../../helpers/tokens';
import { MAX_UINT256 } from '../../helpers/constants';
import { expectBalanceChange } from '../../helpers/tokenBalance';
import { toFixedPoint } from '../../../scripts/helpers/fixedPoint';

describe('StablecoinPool', function () {
  let admin: SignerWithAddress;
  let creator: SignerWithAddress;
  let lp: SignerWithAddress;
  let other: SignerWithAddress;
  let beneficiary: SignerWithAddress;

  let vault: Contract;
  let tokens: TokenList = {};

  const initialBPT = (90e18).toString();
  let poolTokens: string[];
  let poolInitialBalances: BigNumber[];
  let poolAmplification: BigNumber;
  let poolSwapFee: BigNumber;

  let callDeployPool: () => Promise<Contract>;

  before(async function () {
    [, admin, creator, lp, other, beneficiary] = await ethers.getSigners();
  });

  beforeEach(async function () {
    vault = await deploy('Vault', { from: admin, args: [admin.address] });

    tokens = await deployTokens(['DAI', 'MKR', 'SNX', 'BAT'], [18, 18, 18, 18]);
    for (const symbol in tokens) {
      await tokens[symbol].mint(creator.address, (100e18).toString());
      await tokens[symbol].connect(creator).approve(vault.address, MAX_UINT256);

      await tokens[symbol].mint(lp.address, (100e18).toString());
      await tokens[symbol].connect(lp).approve(vault.address, MAX_UINT256);
    }

    poolTokens = [tokens.DAI.address, tokens.MKR.address];
    poolInitialBalances = [0.9e18, 1.8e18].map((value) => BigNumber.from(value.toString()));
    poolAmplification = BigNumber.from('30');
    poolSwapFee = toFixedPoint(0.01);

    callDeployPool = () =>
      deployPoolFromFactory(vault, admin, 'StablecoinPool', {
        from: creator,
        parameters: [initialBPT, poolTokens, poolInitialBalances, poolAmplification, poolSwapFee],
      });
  });

  describe('creation via factory', async () => {
    it('creates a pool in the vault', async () => {
      const pool = await callDeployPool();

      expect(await pool.getVault()).to.equal(vault.address);

      const poolId = await pool.getPoolId();
      expect(await vault.getPool(poolId)).to.have.members([pool.address, TupleTS]);
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

    it('sets amplification factor', async () => {
      const pool = await callDeployPool();
      expect(await pool.getAmplification()).to.deep.equal(poolAmplification);
    });

    it('sets swap fee', async () => {
      const pool = await callDeployPool();
      expect(await pool.getSwapFee()).to.equal(poolSwapFee);
    });

    it("reverts if the number of tokens and amounts don't match", async () => {
      await expect(
        deployPoolFromFactory(vault, admin, 'StablecoinPool', {
          from: creator,
          parameters: [initialBPT, poolTokens, poolInitialBalances.slice(1), poolAmplification, poolSwapFee],
        })
      ).to.be.revertedWith('Create2: Failed on deploy');
    });

    it('reverts if there is a single token', async () => {
      await expect(
        deployPoolFromFactory(vault, admin, 'StablecoinPool', {
          from: creator,
          parameters: [
            initialBPT,
            poolTokens.slice(0, 1),
            poolInitialBalances.slice(0, 1),
            poolAmplification,
            poolSwapFee,
          ],
        })
      ).to.be.revertedWith('Create2: Failed on deploy');
    });

    it('reverts if there are repeated tokens', async () => {
      await expect(
        deployPoolFromFactory(vault, admin, 'StablecoinPool', {
          from: creator,
          parameters: [
            initialBPT,
            new Array(poolTokens.length).fill(poolTokens[0]),
            poolInitialBalances,
            poolAmplification,
            poolSwapFee,
          ],
        })
      ).to.be.revertedWith('Create2: Failed on deploy');
    });

    it('reverts if the swap fee is too high', async () => {
      await expect(
        deployPoolFromFactory(vault, admin, 'StablecoinPool', {
          from: creator,
          parameters: [initialBPT, poolTokens, poolInitialBalances, poolAmplification, toFixedPoint(0.1).add(1)],
        })
      ).to.be.revertedWith('Create2: Failed on deploy');
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
          await vault.connect(admin).setProtocolWithdrawFee(toFixedPoint(protocolWithdrawFee));
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

    describe('draining', () => {
      it('pools can be fully exited', async () => {
        await pool.connect(creator).exitPool(initialBPT, [0, 0], true, creator.address);

        expect(await pool.totalSupply()).to.equal(0);
        expect(await vault.getPoolTokens(poolId)).to.have.members([]);
      });

      it('drained pools cannot be rejoined', async () => {
        await pool.connect(creator).exitPool(initialBPT, [0, 0], true, creator.address);
        //await strategy.setAccSwapFees([]); //Need to reset swap fees accumulated because there are no more tokens

        await expect(
          pool.connect(lp).joinPool((10e18).toString(), [(0.1e18).toString(), (0.2e18).toString()], true, lp.address)
        ).to.be.revertedWith('ERR_DIV_ZERO');
      });
    });
  });

  describe('quotes', () => {
    let pool: Contract;
    let poolId: string;

    context('with three tokens', () => {
      beforeEach(async () => {
        pool = await deployPoolFromFactory(vault, admin, 'StablecoinPool', {
          from: lp,
          parameters: [
            initialBPT,
            [tokens.DAI.address, tokens.MKR.address, tokens.SNX.address],
            [100, 100, 100], // These are not relevant since we're asking for quotes and not swapping via the vault
            (7.6e18).toString(),
            toFixedPoint(0.05),
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
          [(100e18).toString(), (200e18).toString(), (300e18).toString()],
          0,
          1
        );

        expect(result).to.be.at.least((15.7e18).toString());
        expect(result).to.be.at.most((15.8e18).toString());
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
          [(100e18).toString(), (200e18).toString(), (300e18).toString()],
          0,
          1
        );

        expect(result).to.be.at.least((89.8e18).toString());
        expect(result).to.be.at.most((89.9e18).toString());
      });
    });
  });
});
