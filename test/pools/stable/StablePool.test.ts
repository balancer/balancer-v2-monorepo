import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract, ContractFunction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy } from '../../../scripts/helpers/deploy';
import { deployPoolFromFactory, GeneralPool } from '../../../scripts/helpers/pools';
import { deployTokens, TokenList } from '../../helpers/tokens';
import { MAX_UINT128, MAX_UINT256, ZERO_ADDRESS } from '../../helpers/constants';
import { expectBalanceChange } from '../../helpers/tokenBalance';
import { FIXED_POINT_SCALING, toFixedPoint } from '../../../scripts/helpers/fixedPoint';
import { calculateInvariant } from '../../helpers/math/stable';
import { Decimal } from 'decimal.js';

describe('StablePool', function () {
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
  let poolAmplification: BigNumber;
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

      await tokens[symbol].mint(lp.address, (100e18).toString());
      await tokens[symbol].connect(lp).approve(vault.address, MAX_UINT256);

      await tokens[symbol].mint(trader.address, (100e18).toString());
      await tokens[symbol].connect(trader).approve(vault.address, MAX_UINT256);
    }

    poolTokens = [tokens.DAI.address, tokens.MKR.address];
    poolInitialBalances = [0.9e18, 1.8e18].map((value) => BigNumber.from(value.toString()));
    poolAmplification = BigNumber.from('30');
    poolSwapFee = toFixedPoint(0.01);

    callDeployPool = () =>
      deployPoolFromFactory(vault, admin, 'StablePool', {
        from: creator,
        parameters: [initialBPT, poolTokens, poolInitialBalances, poolAmplification, poolSwapFee],
      });
  });

  describe('creation via factory', async () => {
    it('creates a pool in the vault', async () => {
      const pool = await callDeployPool();

      expect(await pool.getVault()).to.equal(vault.address);

      const poolId = await pool.getPoolId();
      expect(await vault.getPool(poolId)).to.have.members([pool.address, GeneralPool]);
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
        deployPoolFromFactory(vault, admin, 'StablePool', {
          from: creator,
          parameters: [initialBPT, poolTokens, poolInitialBalances.slice(1), poolAmplification, poolSwapFee],
        })
      ).to.be.revertedWith('Create2: Failed on deploy');
    });

    it('reverts if there is a single token', async () => {
      await expect(
        deployPoolFromFactory(vault, admin, 'StablePool', {
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
        deployPoolFromFactory(vault, admin, 'StablePool', {
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
        deployPoolFromFactory(vault, admin, 'StablePool', {
          from: creator,
          parameters: [initialBPT, poolTokens, poolInitialBalances, poolAmplification, toFixedPoint(0.1).add(1)],
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

    it('initializes the asset managers', async () => {
      const pool = await callDeployPool();
      const poolId = await pool.getPoolId();

      for (const token of poolTokens) {
        expect(await vault.getPoolAssetManager(poolId, token)).to.equal(ZERO_ADDRESS);
      }
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

      it('can withdraw from internal balance', async () => {
        await vault
          .connect(lp)
          .depositToInternalBalance(
            [tokens.DAI.address, tokens.MKR.address],
            [(1e18).toString(), (1e18).toString()],
            lp.address
          );

        await expectBalanceChange(
          () =>
            pool
              .connect(lp)
              .joinPool((10e18).toString(), [(0.1e18).toString(), (0.2e18).toString()], false, lp.address),
          tokens,
          { account: lp }
        );

        expect(
          (
            await vault.getInternalBalance(lp.address, [tokens.DAI.address, tokens.MKR.address])
          ).map((balance: BigNumber) => balance.toString())
        ).to.deep.equal([(0.9e18).toString(), (0.8e18).toString()]);
      });

      it('transfers missing tokens if internal balance is not enough', async () => {
        await vault
          .connect(lp)
          .depositToInternalBalance(
            [tokens.DAI.address, tokens.MKR.address],
            [BigNumber.from((0.1e18).toString()).sub(1), (0.2e18).toString()],
            lp.address
          );

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

      it('can deposit into internal balance', async () => {
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

      it('can deposit into internal balance', async () => {
        await expectBalanceChange(
          () => pool.connect(lp).exitPool((10e18).toString(), [0, 0], false, lp.address),
          tokens,
          { account: lp }
        );

        expect(
          (
            await vault.getInternalBalance(lp.address, [tokens.DAI.address, tokens.MKR.address])
          ).map((balance: BigNumber) => balance.toString())
        ).to.deep.equal([(0.1e18).toString(), (0.2e18).toString()]);
      });

      it("can deposit into a beneficiary's internal balance", async () => {
        await expectBalanceChange(
          () => pool.connect(lp).exitPool((10e18).toString(), [0, 0], false, beneficiary.address),
          tokens,
          { account: beneficiary }
        );

        expect(
          (
            await vault.getInternalBalance(lp.address, [tokens.DAI.address, tokens.MKR.address])
          ).map((balance: BigNumber) => balance.toString())
        ).to.deep.equal(['0', '0']);
      });
    });

    describe('draining', () => {
      it('pools can be fully exited', async () => {
        await pool.connect(creator).exitPool(initialBPT, [0, 0], true, creator.address);

        expect(await pool.totalSupply()).to.equal(0);

        // The tokens are not unregistered from the Pool
        expect(await vault.getPoolTokens(poolId)).not.to.be.empty;
        expect(await vault.getPoolTokens(poolId)).to.have.members(poolTokens);
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

    context('with three tokens', () => {
      beforeEach(async () => {
        pool = await deployPoolFromFactory(vault, admin, 'StablePool', {
          from: lp,
          parameters: [
            initialBPT,
            [tokens.DAI.address, tokens.MKR.address, tokens.SNX.address],
            [(100e18).toString(), (100e18).toString(), (100e18).toString()], // These are not relevant since we're asking for quotes and not swapping via the vault
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

      it('reverts when querying invalid indexes', async () => {
        const balances = [(100e18).toString(), (200e18).toString(), (300e18).toString()];
        const swap = {
          poolId,
          from: other.address,
          to: other.address,
          tokenIn: tokens.DAI.address,
          tokenOut: tokens.MKR.address,
          amountIn: (16.6e18).toString(), // ~15e18 + 10% fee
          userData: '0x',
        };

        await expect(pool.quoteOutGivenIn(swap, balances, 10, 1)).to.be.revertedWith('ERR_INDEX_OUT_OF_BOUNDS');
        await expect(pool.quoteOutGivenIn(swap, balances, 0, 10)).to.be.revertedWith('ERR_INDEX_OUT_OF_BOUNDS');
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

  /////////Temporary pool creation with mock vault
  const callDeployPoolWithMockVault = async (vault: Contract) => {
    const name = 'Balancer Pool Token';
    const symbol = 'BPT';
    return deploy('StablePool', {
      args: [
        vault.address,
        name,
        symbol,
        0, //Initial BPT is always cero
        poolTokens,
        ['0', '0'], //Initial Balances are empty
        admin.address,
        poolAmplification,
        poolSwapFee,
      ],
    });
  };
  //////////Temporary

  const INIT = 0;
  const EXACT_TOKENS_IN_FOR_EXACT_BPT_OUT = 1;

  const encodeJoinInitialUserData = (): string => {
    return ethers.utils.defaultAbiCoder.encode(['uint256'], [INIT]);
  };
  const encodeJoinAllTokensInForExactBPTOutUserData = (minimumBPT: string): string => {
    return ethers.utils.defaultAbiCoder.encode(['uint256', 'uint256'], [EXACT_TOKENS_IN_FOR_EXACT_BPT_OUT, minimumBPT]);
  };

  describe('join hook', () => {
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
          new Decimal(poolAmplification.toString()),
          initialBalances.map((value) => new Decimal(value.toString()))
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
        expect(newBPT.sub(previousBPT)).to.be.at.least(invariant.sub(0.005e18).toFixed(0));
        expect(newBPT.sub(previousBPT)).to.be.at.most(invariant.add(0.005e18).toFixed(0));
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

    context('join all tokens in for exact BPT out', () => {
      it('fails if not intialized', async () => {
        const joinUserData = encodeJoinAllTokensInForExactBPTOutUserData('0');
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

        it('grants exact bpt', async () => {
          const previousBPT = await pool.balanceOf(lp.address);

          const bptOut = (0.01e18).toString();
          const joinUserData = encodeJoinAllTokensInForExactBPTOutUserData(bptOut);
          const inBalances = [0.1e18, 0.1e18].map((value) => BigNumber.from(value.toString()));

          await vault
            .connect(lp)
            .joinPool(pool.address, poolId, lp.address, poolTokens, inBalances, false, joinUserData);

          const newBPT = await pool.balanceOf(lp.address);
          expect(newBPT.sub(previousBPT)).to.be.at.least((0.01e18).toString());
          expect(newBPT.sub(previousBPT)).to.be.at.most((0.011e18).toString());
        });

        it('fails if not enough tokens', async () => {
          const bptOut = (1e18).toString();
          const joinUserData = encodeJoinAllTokensInForExactBPTOutUserData(bptOut);
          const inBalances = [0.1e18, 0.1e18].map((value) => BigNumber.from(value.toString()));

          await expect(
            vault.connect(lp).joinPool(pool.address, poolId, lp.address, poolTokens, inBalances, false, joinUserData)
          ).to.be.be.revertedWith('ERR_LIMIT_IN');
        });
      });
    });
  });

  describe('exit hook', () => {
    let vault: Contract;
    let pool: Contract;
    let poolId: string;
    const protocolSwapFee = toFixedPoint(0);
    const emptyBalances = (poolInitialBalances = [0, 0].map((value) => BigNumber.from(value.toString())));

    const encodeExitExactBPTInForAllTokensOutUserData = (bptAmountIn: string): string => {
      return ethers.utils.defaultAbiCoder.encode(['uint256'], [bptAmountIn]);
    };

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
      const bptOut = (0.01e18).toString();
      const joinUserData = encodeJoinAllTokensInForExactBPTOutUserData(bptOut);
      const inBalances = [0.1e18, 0.1e18].map((value) => BigNumber.from(value.toString()));
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

    //TODO: wrong user data is decoded without error

    context('exit exact BPT in for all tokens out', () => {
      it('grants all tokens for exact bpt', async () => {
        const prevBPT = await pool.balanceOf(lp.address);
        const prevBalances = await vault.getPoolCurrentBalances();

        const exitUserData = encodeExitExactBPTInForAllTokensOutUserData(prevBPT);
        const minAmountsOut = [0.001e18, 0.001e18].map((value) => BigNumber.from(value.toString()));

        await vault
          .connect(lp)
          .exitPool(pool.address, poolId, lp.address, poolTokens, minAmountsOut, false, exitUserData);

        const newBalances = await vault.getPoolCurrentBalances();
        expect(prevBalances[0].sub(newBalances[0])).to.be.at.least((0.0033e18).toString());
        expect(prevBalances[0].sub(newBalances[0])).to.be.at.most((0.0034e18).toString());

        expect(prevBalances[1].sub(newBalances[1])).to.be.at.least((0.0066e18).toString());
        expect(prevBalances[1].sub(newBalances[1])).to.be.at.most((0.0067e18).toString());

        const newBPT = await pool.balanceOf(lp.address);
        expect(newBPT).to.be.equal((0).toString());
      });

      it('fails if not enough tokens out', async () => {
        const prevBPT = await pool.balanceOf(lp.address);

        const exitUserData = encodeExitExactBPTInForAllTokensOutUserData(prevBPT);
        const minAmountsOut = [0.02e18, 0.04e18].map((value) => BigNumber.from(value.toString()));

        await expect(
          vault.connect(lp).exitPool(pool.address, poolId, lp.address, poolTokens, minAmountsOut, false, exitUserData)
        ).to.be.be.revertedWith('ERR_EXIT_BELOW_REQUESTED_MINIMUM');
      });
    });
  });

  describe.skip('protocol swap fees', () => {
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

      initialBalances = [BigNumber.from((10e18).toString()), BigNumber.from((10e18).toString())];
      tokenAddresses = [tokens.DAI.address, tokens.MKR.address];
      tokenWeights = [(8e18).toString(), (2e18).toString()];

      pool = await deployPoolFromFactory(vault, admin, 'WeightedPool', {
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
          withdrawFromInternalBalance: false,
          depositToInternalBalance: false,
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

      it('pays swap protocol fees on exit', async () => {
        await assertProtocolSwapFeeIsCharged(() =>
          pool.connect(lp).exitPool((1e18).toString(), [0, 0], true, lp.address)
        );
      });
    });
  });
});
