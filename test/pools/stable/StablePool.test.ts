import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract, ContractFunction } from 'ethers';
import { expectEqualWithError, bn } from '../../helpers/numbers';
import * as expectEvent from '../../helpers/expectEvent';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy } from '../../../scripts/helpers/deploy';
import { GeneralPool } from '../../../scripts/helpers/pools';
import { deploySortedTokens, deployTokens, TokenList } from '../../helpers/tokens';
import { MAX_UINT128, MAX_UINT256, ZERO_ADDRESS } from '../../helpers/constants';
import { FIXED_POINT_SCALING, toFixedPoint } from '../../../scripts/helpers/fixedPoint';
import { Decimal } from 'decimal.js';
import { calculateInvariant } from '../../helpers/math/stable';

const INIT = 0;
const ALL_TOKENS_IN_FOR_EXACT_BPT_OUT = 1;

const encodeInitialJoinUserData = (): string => {
  return ethers.utils.defaultAbiCoder.encode(['uint256'], [INIT]);
};
const encodeJoinAllTokensInForExactBPTOutUserData = (bptAmountOut: string): string => {
  return ethers.utils.defaultAbiCoder.encode(['uint256', 'uint256'], [ALL_TOKENS_IN_FOR_EXACT_BPT_OUT, bptAmountOut]);
};

const encodeExitExactBPTInForAllTokensOutUserData = (bptAmountIn: string): string => {
  return ethers.utils.defaultAbiCoder.encode(['uint256'], [bptAmountIn]);
};

describe('StablePool', function () {
  let authorizer: Contract, vault: Contract;
  let tokenList: TokenList, tokens: Array<Contract>;
  let admin: SignerWithAddress, creator: SignerWithAddress, lp: SignerWithAddress;
  let trader: SignerWithAddress, beneficiary: SignerWithAddress, feeSetter: SignerWithAddress, other: SignerWithAddress;

  const POOL_SWAP_FEE = toFixedPoint(0.01);

  const SYMBOLS = ['DAI', 'MKR', 'SNX', 'BAT'];
  const INITIAL_BALANCES = [bn(10e18), bn(11e18), bn(12e18), bn(13e18)];

  before('setup signers', async () => {
    [, admin, creator, lp, trader, beneficiary, feeSetter, other] = await ethers.getSigners();
    authorizer = await deploy('Authorizer', { args: [admin.address] });
  });

  beforeEach('deploy tokens', async () => {
    vault = await deploy('Vault', { args: [authorizer.address] });
    tokenList = await deploySortedTokens(SYMBOLS, [18, 18, 18, 18]);
    tokens = Object.values(tokenList);

    for (const token of tokens) {
      await token.mint(creator.address, bn(100e18));
      await token.connect(creator).approve(vault.address, MAX_UINT256);

      await token.mint(lp.address, bn(100e18));
      await token.connect(lp).approve(vault.address, MAX_UINT256);

      await token.mint(trader.address, bn(100e18));
      await token.connect(trader).approve(vault.address, MAX_UINT256);
    }
  });

  context('for a 1 token pool', () => {
    it('reverts if there is a single token', async () => {
      const poolTokens = tokens.map((token) => token.address).slice(0, 1);
      await expect(
        deploy('StablePool', {
          args: [vault.address, 'Balancer Pool Token', 'BPT', poolTokens, 0, 0],
        })
      ).to.be.revertedWith('ERR_MIN_TOKENS');
    });
  });

  context('for a 2 token pool', () => {
    itBehavesAsStablePool(2);
  });

  context('for a 3 token pool', () => {
    itBehavesAsStablePool(3);
  });

  context('for a too-many token pool', () => {
    it('reverts if there are too many tokens', async () => {
      // The maximum number of tokens is 16
      const manyTokens = await deployTokens(
        Array(17)
          .fill('TK')
          .map((v, i) => `${v}${i}`),
        Array(17).fill(18)
      );
      const poolTokens = Object.values(manyTokens).map((token) => token.address);

      await expect(
        deploy('StablePool', {
          args: [vault.address, 'Balancer Pool Token', 'BPT', poolTokens, 0, 0],
        })
      ).to.be.revertedWith('ERR_MAX_TOKENS');
    });
  });

  function itBehavesAsStablePool(numberOfTokens: number) {
    let poolTokens: string[];

    const poolAmplification = bn(100e18);
    const poolInitialBalances = INITIAL_BALANCES.slice(0, numberOfTokens);

    async function deployPool({
      tokens,
      amplification,
      swapFee,
    }: {
      tokens?: string[];
      amplification?: BigNumber;
      swapFee?: BigNumber;
    }) {
      tokens = tokens ? tokens : [];
      amplification = amplification ? amplification : poolAmplification;
      swapFee = swapFee ? swapFee : POOL_SWAP_FEE;

      return deploy('StablePool', {
        args: [vault.address, 'Balancer Pool Token', 'BPT', tokens, amplification, swapFee],
      });
    }

    beforeEach('define pool tokens', () => {
      poolTokens = tokens.map((token) => token.address).slice(0, numberOfTokens);
    });

    describe('creation', async () => {
      context('when the creation succeeds', () => {
        let pool: Contract;

        beforeEach('deploy pool', async () => {
          pool = await deployPool({ tokens: poolTokens });
        });

        it('sets the vault', async () => {
          expect(await pool.getVault()).to.equal(vault.address);
        });

        it('uses general specialization', async () => {
          const poolId = await pool.getPoolId();
          expect(await vault.getPool(poolId)).to.have.members([pool.address, GeneralPool]);
        });

        it('registers tokens in the vault', async () => {
          const poolId = await pool.getPoolId();

          expect(await vault.getPoolTokens(poolId)).to.have.members(poolTokens);
          expect(await vault.getPoolTokenBalances(poolId, poolTokens)).to.deep.equal(
            Array(poolTokens.length).fill(bn(0))
          );
        });

        it('initializes the asset managers', async () => {
          const poolId = await pool.getPoolId();

          for (const token of poolTokens) {
            expect(await vault.getPoolAssetManager(poolId, token)).to.equal(ZERO_ADDRESS);
          }
        });

        it('starts with no BPT', async () => {
          expect(await pool.totalSupply()).to.deep.equal(0);
        });

        it('sets amplification', async () => {
          expect(await pool.getAmplification()).to.deep.equal(poolAmplification);
        });

        it('sets swap fee', async () => {
          expect(await pool.getSwapFee()).to.equal(POOL_SWAP_FEE);
        });

        it('sets the name', async () => {
          expect(await pool.name()).to.equal('Balancer Pool Token');
        });

        it('sets the symbol', async () => {
          expect(await pool.symbol()).to.equal('BPT');
        });

        it('sets the decimals', async () => {
          expect(await pool.decimals()).to.equal(18);
        });
      });

      context('when the creation fails', () => {
        it('reverts if there are repeated tokens', async () => {
          const tokens = new Array(poolTokens.length).fill(poolTokens[0]);

          await expect(deployPool({ tokens })).to.be.revertedWith('ERR_TOKEN_ALREADY_REGISTERED');
        });

        it('reverts if the swap fee is too high', async () => {
          const swapFee = toFixedPoint(0.1).add(1);

          await expect(deployPool({ tokens: poolTokens, swapFee })).to.be.revertedWith('ERR_MAX_SWAP_FEE');
        });
      });
    });

    describe('onJoinPool', () => {
      let pool: Contract;
      let poolId: string;

      beforeEach(async () => {
        //Use a mock vault
        vault = await deploy('MockVault', { args: [] });
        pool = await deployPool({ tokens: poolTokens });
        poolId = await pool.getPoolId();
      });

      it('fails if caller is not the vault', async () => {
        await expect(
          pool.connect(lp).onJoinPool(poolId, lp.address, other.address, [0], [0], 0, '0x')
        ).to.be.revertedWith('ERR_CALLER_NOT_VAULT');
      });

      it.skip('fails if wrong pool id'); // if Pools can only register themselves, this is unnecessary

      it.skip('fails if no user data', async () => {
        await expect(
          vault
            .connect(lp)
            .callJoinPool(
              pool.address,
              poolId,
              beneficiary.address,
              Array(poolTokens.length).fill(0),
              Array(poolTokens.length).fill(0),
              0,
              '0x'
            )
        ).to.be.revertedWith('Transaction reverted without a reason');

        //NOTE
        //If use `to.be.be.revertedWith('Transaction reverted without a reason'), hardhat throws:
        // `AssertionError: Expected transaction to be reverted with Transaction reverted
        // without a reason, but other exception was thrown: Error: Transaction reverted
        //and Hardhat couldn't infer the reason. Please report this to help us improve Hardhat.`
      });

      it.skip('fails if wrong user data', async () => {
        const wrongUserData = ethers.utils.defaultAbiCoder.encode(['address'], [lp.address]);

        await expect(
          vault
            .connect(lp)
            .callJoinPool(
              pool.address,
              poolId,
              beneficiary.address,
              Array(poolTokens.length).fill(0),
              Array(poolTokens.length).fill(0),
              0,
              wrongUserData
            )
        ).to.be.revertedWith('Transaction reverted without a reason');

        //NOTE
        //Same problem with `revertedWith` as before
      });

      context('initialization', () => {
        let initialJoinUserData: string;

        beforeEach(async () => {
          initialJoinUserData = encodeInitialJoinUserData();
        });

        it('grants the invariant amount of BPT', async () => {
          const invariant = bn(
            calculateInvariant(
              new Decimal(poolAmplification.toString()),
              poolInitialBalances.map((value) => new Decimal(value.toString()))
            ).toFixed(0)
          );

          const receipt = await (
            await vault
              .connect(creator)
              .callJoinPool(
                pool.address,
                poolId,
                beneficiary.address,
                Array(poolTokens.length).fill(0),
                poolInitialBalances,
                0,
                initialJoinUserData
              )
          ).wait();

          const event = expectEvent.inReceipt(receipt, 'PoolJoined');
          const amountsIn = event.args.amountsIn;
          const dueProtocolFeeAmounts = event.args.dueProtocolFeeAmounts;

          // Amounts in should be the same as initial ones
          expect(amountsIn).to.deep.equal(poolInitialBalances);

          // Protocol fees should be zero
          expect(dueProtocolFeeAmounts).to.deep.equal(Array(poolTokens.length).fill(bn(0)));

          // Initial balances should equal invariant
          const bpt = await pool.balanceOf(beneficiary.address);
          expectEqualWithError(bpt, invariant, 0.001);
        });

        it('fails if already initialized', async () => {
          await vault
            .connect(creator)
            .callJoinPool(
              pool.address,
              poolId,
              beneficiary.address,
              Array(poolTokens.length).fill(0),
              poolInitialBalances,
              0,
              initialJoinUserData
            );

          await expect(
            vault
              .connect(creator)
              .callJoinPool(
                pool.address,
                poolId,
                beneficiary.address,
                Array(poolTokens.length).fill(0),
                poolInitialBalances,
                0,
                initialJoinUserData
              )
          ).to.be.be.revertedWith('ERR_ALREADY_INITIALIZED');
        });
      });

      context('join exact tokens in for BPT out', () => {
        it('fails if not initialized', async () => {
          const joinUserData = encodeJoinAllTokensInForExactBPTOutUserData('0');
          await expect(
            vault
              .connect(creator)
              .callJoinPool(
                pool.address,
                poolId,
                beneficiary.address,
                Array(poolTokens.length).fill(0),
                poolInitialBalances,
                0,
                joinUserData
              )
          ).to.be.be.revertedWith('ERR_UNINITIALIZED');
        });

        context('once initialized', () => {
          beforeEach(async () => {
            const initialJoinUserData = encodeInitialJoinUserData();
            await vault
              .connect(creator)
              .callJoinPool(
                pool.address,
                poolId,
                beneficiary.address,
                Array(poolTokens.length).fill(0),
                poolInitialBalances,
                0,
                initialJoinUserData
              );
          });

          it('grants exact BPT', async () => {
            const previousBPT = await pool.balanceOf(beneficiary.address);

            const bptAmountOut = (10e18).toString();
            const joinUserData = encodeJoinAllTokensInForExactBPTOutUserData(bptAmountOut);
            const maxAmountsIn = Array(poolTokens.length).fill(bn(20e18));

            const receipt = await (
              await vault
                .connect(lp)
                .callJoinPool(
                  pool.address,
                  poolId,
                  beneficiary.address,
                  poolInitialBalances,
                  maxAmountsIn,
                  0,
                  joinUserData
                )
            ).wait();

            const event = expectEvent.inReceipt(receipt, 'PoolJoined');
            const dueProtocolFeeAmounts = event.args.dueProtocolFeeAmounts;

            // Protocol fees should be zero
            expect(dueProtocolFeeAmounts).to.deep.equal(Array(poolTokens.length).fill(bn(0)));

            const newBPT = await pool.balanceOf(beneficiary.address);
            expect(newBPT.sub(previousBPT)).to.equal(bptAmountOut);
          });
        });
      });
    });

    describe('onExitPool', () => {
      let pool: Contract;
      let poolId: string;

      beforeEach(async () => {
        //Use a mock vault
        vault = await deploy('MockVault', { args: [] });
        pool = await deployPool({ tokens: poolTokens });
        poolId = await pool.getPoolId();

        // Initialize from creator
        const initialJoinUserData = encodeInitialJoinUserData();
        await vault
          .connect(creator)
          .callJoinPool(
            pool.address,
            poolId,
            lp.address,
            Array(poolTokens.length).fill(0),
            poolInitialBalances,
            0,
            initialJoinUserData
          );
      });

      it('fails if caller is not the vault', async () => {
        await expect(
          pool.connect(lp).onExitPool(poolId, beneficiary.address, other.address, [0], [0], 0, '0x')
        ).to.be.revertedWith('ERR_CALLER_NOT_VAULT');
      });

      it.skip('fails if wrong pool id'); // if Pools can only register themselves, this is unnecessary

      it.skip('fails if no user data', async () => {
        await expect(
          vault
            .connect(lp)
            .callExitPool(
              pool.address,
              poolId,
              beneficiary.address,
              poolInitialBalances,
              Array(poolTokens.length).fill(0),
              0,
              '0x'
            )
        ).to.be.be.revertedWith('Transaction reverted without a reason');
      });

      it.skip('fails if wrong user data', async () => {
        const wrongUserData = ethers.utils.defaultAbiCoder.encode(['address'], [lp.address]);

        await expect(
          vault
            .connect(lp)
            .callExitPool(
              pool.address,
              poolId,
              beneficiary.address,
              poolInitialBalances,
              Array(poolTokens.length).fill(0),
              0,
              wrongUserData
            )
        ).to.be.be.revertedWith('Transaction reverted without a reason');
      });

      context('exit exact BPT in for all tokens out', () => {
        it('grants all tokens for exact bpt', async () => {
          // Exit with half of BPT
          const prevBPT = await pool.balanceOf(lp.address);
          const exitUserData = encodeExitExactBPTInForAllTokensOutUserData(prevBPT.div(2));
          const minAmountsOut = Array(poolTokens.length).fill(bn(0.01e18));

          const receipt = await (
            await vault
              .connect(lp)
              .callExitPool(
                pool.address,
                poolId,
                beneficiary.address,
                poolInitialBalances,
                minAmountsOut,
                0,
                exitUserData
              )
          ).wait();

          const event = expectEvent.inReceipt(receipt, 'PoolExited');
          const amountsOut = event.args.amountsOut;
          const dueProtocolFeeAmounts = event.args.dueProtocolFeeAmounts;

          // Protocol fees should be zero
          expect(dueProtocolFeeAmounts).to.deep.equal(Array(poolTokens.length).fill(bn(0)));

          //All balances are extracted
          for (let i = 0; i < poolTokens.length; ++i) {
            expectEqualWithError(amountsOut[i], poolInitialBalances[i].div(2), 0.001);
          }

          expectEqualWithError(await pool.balanceOf(lp.address), prevBPT.div(2), 0.001);
        });

        it('fully exit', async () => {
          const prevBPT = await pool.balanceOf(lp.address);
          const exitUserData = encodeExitExactBPTInForAllTokensOutUserData(prevBPT);
          const minAmountsOut = Array(poolTokens.length).fill(bn(0.01e18));

          const receipt = await (
            await vault
              .connect(lp)
              .callExitPool(
                pool.address,
                poolId,
                beneficiary.address,
                poolInitialBalances,
                minAmountsOut,
                0,
                exitUserData
              )
          ).wait();

          const event = expectEvent.inReceipt(receipt, 'PoolExited');
          const amountsOut = event.args.amountsOut;
          const dueProtocolFeeAmounts = event.args.dueProtocolFeeAmounts;

          // Protocol fees should be zero
          expect(dueProtocolFeeAmounts).to.deep.equal(Array(poolTokens.length).fill(bn(0)));

          //All balances are extracted
          expect(amountsOut).to.deep.equal(poolInitialBalances);

          expect(await pool.balanceOf(lp.address)).to.equal(0);
        });
      });
    });

    describe('quotes', () => {
      let pool: Contract;
      let poolId: string;

      let quoteData: {
        poolId: string;
        from: string;
        to: string;
        tokenIn: string;
        tokenOut: string;
        userData: string;
      };

      beforeEach('set default quote data', async () => {
        pool = await deployPool({ tokens: poolTokens });
        poolId = await pool.getPoolId();

        quoteData = {
          poolId,
          from: other.address,
          to: other.address,
          tokenIn: tokenList.DAI.address,
          tokenOut: tokenList.MKR.address,
          userData: '0x',
        };
      });

      context('given in', () => {
        it('quotes amount out', async () => {
          const result = await pool.quoteOutGivenIn({ ...quoteData, amountIn: bn(1e18) }, poolInitialBalances, 0, 1);

          //TODO: check with math once defined if analytical or approximation is used
          expectEqualWithError(result, 0.99e18, 0.001);
        });
      });

      context('given out', () => {
        it('quotes amount in', async () => {
          const result = await pool.quoteInGivenOut({ ...quoteData, amountOut: bn(1e18) }, poolInitialBalances, 0, 1);

          //TODO: check with math once defined if analytical or approximation is used
          expectEqualWithError(result, 1.01e18, 0.001);
        });
      });

      it('reverts when querying out given in invalid indexes', async () => {
        await expect(
          pool.quoteOutGivenIn({ ...quoteData, amountIn: bn(1e18) }, poolInitialBalances, 10, 1)
        ).to.be.revertedWith('ERR_INDEX_OUT_OF_BOUNDS');
        await expect(
          pool.quoteOutGivenIn({ ...quoteData, amountIn: bn(1e18) }, poolInitialBalances, 0, 10)
        ).to.be.revertedWith('ERR_INDEX_OUT_OF_BOUNDS');
      });

      it('reverts when querying in given out invalid indexes', async () => {
        await expect(
          pool.quoteInGivenOut({ ...quoteData, amountOut: bn(1e18) }, poolInitialBalances, 10, 1)
        ).to.be.revertedWith('ERR_INDEX_OUT_OF_BOUNDS');
        await expect(
          pool.quoteInGivenOut({ ...quoteData, amountOut: bn(1e18) }, poolInitialBalances, 0, 10)
        ).to.be.revertedWith('ERR_INDEX_OUT_OF_BOUNDS');
      });
    });

    describe.skip('protocol swap fees', () => {
      let pool: Contract;
      let poolId: string;

      const swapFee = toFixedPoint(0.05); // 5 %
      const protocolSwapFee = toFixedPoint(0.1); // 10 %

      beforeEach(async () => {
        //Set protocol swap fee in Vault
        await authorizer.connect(admin).grantRole(await authorizer.SET_PROTOCOL_SWAP_FEE_ROLE(), feeSetter.address);
        await vault.connect(feeSetter).setProtocolSwapFee(protocolSwapFee);

        pool = await deployPool({ tokens: poolTokens });
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

        expect(await vault.getCollectedFeesByToken(tokenList.DAI.address)).to.equal(0);
        expect(await vault.getCollectedFeesByToken(tokenList.MKR.address)).to.equal(0);
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

          await vault.connect(trader).batchSwapGivenIn(ZERO_ADDRESS, '0x', [swap], tokens, funds);
        });

        async function assertProtocolSwapFeeIsCharged(payFeesAction: ContractFunction) {
          const previousBlockHash = (await ethers.provider.getBlock('latest')).hash;
          const paidTokenIndex = BigNumber.from(previousBlockHash).mod(tokens.length).toNumber();
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
            const finalBalances = await vault.getPoolTokenBalances(poolId, tokens);
            expectedPaidFees = await pool.quoteOutGivenIn(
              {
                poolId,
                from: other.address,
                to: other.address,
                tokenIn: tokenList.DAI.address,
                tokenOut: tokenList.MKR.address,
                amountIn: protocolSwapFeeAmount,
                userData: '0x',
              },
              finalBalances[0],
              finalBalances[1]
            );
            // Since the expected fees is an approximation, we expect a greater error
            error = expectedPaidFees.div(10);
          }

          const paidTokenFees = await vault.getCollectedFeesByToken(tokens[paidTokenIndex]);
          expect(paidTokenFees).be.at.least(expectedPaidFees.sub(error));
          expect(paidTokenFees).be.at.most(expectedPaidFees.add(error));

          const notPaidTokenFees = await vault.getCollectedFeesByToken(tokens[notPaidTokenIndex]);
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
  }
});
