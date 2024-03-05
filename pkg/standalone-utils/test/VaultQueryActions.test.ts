import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { BigNumberish, FP_ZERO, fp } from '@balancer-labs/v2-helpers/src/numbers';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { SwapKind, UserBalanceOpKind, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import { MAX_UINT112, MAX_UINT256, randomAddress } from '@balancer-labs/v2-helpers/src/constants';
import { Contract, BigNumber } from 'ethers';
import { expect } from 'chai';
import { expectChainedReferenceContents, toChainedReference } from './helpers/chainedReferences';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import {
  setupRelayerEnvironment,
  encodeSwap,
  encodeBatchSwap,
  encodeJoinPool,
  encodeExitPool,
  PoolKind,
  OutputReference,
} from './VaultActionsRelayer.setup';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expectArrayEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { defaultAbiCoder } from 'ethers/lib/utils';

describe('VaultQueryActions', function () {
  const INITIAL_BALANCE = fp(1000);

  let queries: Contract;
  let vault: Vault;
  let tokens: TokenList;
  let relayer: Contract, relayerLibrary: Contract;
  let user: SignerWithAddress, other: SignerWithAddress;
  let poolA: WeightedPool;

  let poolIdA: string;
  let tokensA: TokenList;

  let recipient: Account;

  before('setup environment', async () => {
    ({ user, other, vault, relayer, relayerLibrary } = await setupRelayerEnvironment());
    queries = await deploy('BalancerQueries', { args: [vault.address] });
  });

  before('setup common recipient', () => {
    // All the tests use the same recipient; this is a simple abstraction to improve readability.
    recipient = randomAddress();
  });

  sharedBeforeEach('set up pools', async () => {
    tokens = (await TokenList.create(['DAI', 'MKR', 'SNX', 'BAT'])).sort();
    await tokens.mint({ to: user });
    await tokens.approve({ to: vault, from: user });

    // Pool A: DAI-MKR
    tokensA = new TokenList([tokens.DAI, tokens.MKR]).sort();
    poolA = await WeightedPool.create({
      tokens: tokensA,
      vault,
    });
    await poolA.init({ initialBalances: INITIAL_BALANCE, from: user });

    poolIdA = await poolA.getPoolId();
  });

  describe('simple swap', () => {
    const amountIn = fp(2);

    context('when caller is not authorized', () => {
      it('reverts', async () => {
        expect(
          relayer.connect(other).vaultActionsQueryMulticall([
            encodeSwap(relayerLibrary, {
              poolId: poolIdA,
              tokenIn: tokens.DAI,
              tokenOut: tokens.MKR,
              amount: amountIn,
              sender: user.address,
              recipient,
            }),
          ])
        ).to.be.revertedWith('Incorrect sender');
      });
    });

    context('when caller is authorized', () => {
      let sender: Account;

      context('sender = user', () => {
        beforeEach(() => {
          sender = user;
        });

        itTestsSimpleSwap();
      });

      context('sender = relayer', () => {
        beforeEach(() => {
          sender = relayer;
        });

        itTestsSimpleSwap();
      });

      function itTestsSimpleSwap() {
        describe('simple swap', () => {
          let expectedAmountOut: BigNumber;

          sharedBeforeEach('get expected amount out', async () => {
            expectedAmountOut = await queries.querySwap(
              {
                poolId: poolIdA,
                kind: SwapKind.GivenIn,
                assetIn: tokens.DAI.address,
                assetOut: tokens.MKR.address,
                amount: amountIn,
                userData: '0x',
              },
              {
                sender: TypesConverter.toAddress(sender),
                recipient: TypesConverter.toAddress(recipient),
                fromInternalBalance: false,
                toInternalBalance: false,
              }
            );
          });

          it('stores swap output as chained reference', async () => {
            await (
              await relayer.connect(user).vaultActionsQueryMulticall([
                encodeSwap(relayerLibrary, {
                  poolId: poolIdA,
                  tokenIn: tokens.DAI,
                  tokenOut: tokens.MKR,
                  amount: amountIn,
                  outputReference: toChainedReference(0),
                  sender,
                  recipient,
                }),
              ])
            ).wait();

            await expectChainedReferenceContents(relayer, toChainedReference(0), expectedAmountOut);
          });

          it('returns the swap output directly', async () => {
            const [actualAmountOut] = await relayer.connect(user).callStatic.vaultActionsQueryMulticall([
              encodeSwap(relayerLibrary, {
                poolId: poolIdA,
                tokenIn: tokens.DAI,
                tokenOut: tokens.MKR,
                amount: amountIn,
                sender,
                recipient,
              }),
            ]);

            expect(actualAmountOut).to.equal(expectedAmountOut);
          });
        });
      }
    });
  });

  describe('batch swap', () => {
    const amountIn = fp(5);

    context('when caller is not authorized', () => {
      it('reverts', async () => {
        expect(
          relayer.connect(other).vaultActionsQueryMulticall([
            encodeBatchSwap({
              relayerLibrary,
              tokens,
              swaps: [
                { poolId: poolIdA, tokenIn: tokens.DAI, tokenOut: tokens.MKR, amount: amountIn },
                { poolId: poolIdA, tokenIn: tokens.MKR, tokenOut: tokens.DAI, amount: 0 },
              ],
              sender: other,
              recipient,
            }),
          ])
        ).to.be.revertedWith('Incorrect sender');
      });
    });

    context('when caller is authorized', () => {
      let sender: Account;

      context('sender = user', () => {
        beforeEach(() => {
          sender = user;
        });

        itTestsBatchSwap();
      });

      context('sender = relayer', () => {
        beforeEach(() => {
          sender = relayer;
        });

        itTestsBatchSwap();
      });

      function itTestsBatchSwap() {
        describe('batch swap', () => {
          const amount = fp(1);

          it('stores batch swap output as chained reference', async () => {
            const indexIn = tokens.indexOf(tokens.DAI);
            const indexOut = tokens.indexOf(tokens.MKR);

            const result = await queries.queryBatchSwap(
              SwapKind.GivenIn,
              [{ poolId: poolIdA, assetInIndex: indexIn, assetOutIndex: indexOut, amount, userData: '0x' }],
              tokens.addresses,
              {
                sender: TypesConverter.toAddress(sender),
                recipient,
                fromInternalBalance: false,
                toInternalBalance: false,
              }
            );

            expect(result[indexIn]).to.deep.equal(amount);
            const expectedAmountOut = result[indexOut].mul(-1);

            await (
              await relayer.connect(user).vaultActionsQueryMulticall([
                encodeBatchSwap({
                  relayerLibrary,
                  tokens,
                  swaps: [{ poolId: poolIdA, tokenIn: tokens.DAI, tokenOut: tokens.MKR, amount }],
                  sender,
                  recipient,
                  outputReferences: { MKR: toChainedReference(0) },
                }),
              ])
            ).wait();

            await expectChainedReferenceContents(relayer, toChainedReference(0), expectedAmountOut);
          });

          it('stores batch swap output directly', async () => {
            const indexIn = tokens.indexOf(tokens.DAI);
            const indexOut = tokens.indexOf(tokens.MKR);

            const result = await queries.queryBatchSwap(
              SwapKind.GivenIn,
              [{ poolId: poolIdA, assetInIndex: indexIn, assetOutIndex: indexOut, amount, userData: '0x' }],
              tokens.addresses,
              {
                sender: TypesConverter.toAddress(sender),
                recipient,
                fromInternalBalance: false,
                toInternalBalance: false,
              }
            );

            expect(result[indexIn]).to.deep.equal(amount);
            const expectedAmountOut = result[indexOut].mul(-1);

            const [encodedResult] = await relayer.connect(user).callStatic.vaultActionsQueryMulticall([
              encodeBatchSwap({
                relayerLibrary,
                tokens,
                swaps: [{ poolId: poolIdA, tokenIn: tokens.DAI, tokenOut: tokens.MKR, amount }],
                sender,
                recipient,
              }),
            ]);

            const [actualResult] = defaultAbiCoder.decode(['uint256[]'], encodedResult);
            const actualAmountOut = MAX_UINT256.sub(actualResult[indexOut]);

            expect(actualAmountOut).to.almostEqual(expectedAmountOut);
          });
        });
      }
    });
  });

  describe('join', () => {
    let expectedBptOut: BigNumber, amountsIn: BigNumber[], data: string;
    const maxAmountsIn: BigNumber[] = [MAX_UINT112, MAX_UINT112];

    sharedBeforeEach('estimate expected bpt out', async () => {
      amountsIn = [fp(1), fp(0)];
      data = WeightedPoolEncoder.joinExactTokensInForBPTOut(amountsIn, 0);
    });

    context('when caller is not authorized', () => {
      it('reverts', async () => {
        expect(
          relayer.connect(other).vaultActionsQueryMulticall([
            encodeJoinPool(vault, relayerLibrary, {
              poolId: poolIdA,
              userData: data,
              sender: user.address,
              recipient,
              poolKind: PoolKind.WEIGHTED,
            }),
          ])
        ).to.be.revertedWith('Incorrect sender');
      });
    });

    context('when caller is authorized', () => {
      let sender: Account;

      context('sender = user', () => {
        beforeEach(() => {
          sender = user;
        });

        itTestsJoin();
      });

      context('sender = relayer', () => {
        beforeEach(() => {
          sender = relayer;
        });

        itTestsJoin();
      });

      function itTestsJoin() {
        it('stores join result as chained reference', async () => {
          const result = await queries.queryJoin(poolIdA, TypesConverter.toAddress(sender), recipient, {
            assets: tokensA.addresses,
            maxAmountsIn,
            fromInternalBalance: false,
            userData: data,
          });

          expect(result.amountsIn).to.deep.equal(amountsIn);
          expectedBptOut = result.bptOut;

          await (
            await relayer.connect(user).vaultActionsQueryMulticall([
              encodeJoinPool(vault, relayerLibrary, {
                poolId: poolIdA,
                userData: data,
                outputReference: toChainedReference(0),
                sender,
                recipient,
                poolKind: PoolKind.WEIGHTED,
              }),
            ])
          ).wait();

          await expectChainedReferenceContents(relayer, toChainedReference(0), expectedBptOut);
        });
      }
    });
  });

  describe('exit', () => {
    let bptIn: BigNumber, calculatedAmountsOut: BigNumber[], data: string;
    const minAmountsOut: BigNumber[] = [];

    sharedBeforeEach('estimate expected amounts out', async () => {
      bptIn = (await poolA.totalSupply()).div(5);
      const tokenIn = await poolA.estimateTokenOut(0, bptIn);
      calculatedAmountsOut = [BigNumber.from(tokenIn), FP_ZERO];
      // Use a non-proportional exit so that the token amounts are different
      // (so that we can see whether indexes are used)
      data = WeightedPoolEncoder.exitExactBPTInForOneTokenOut(bptIn, 0);
    });

    context('when caller is not authorized', () => {
      it('reverts', async () => {
        expect(
          relayer.connect(other).vaultActionsQueryMulticall([
            encodeExitPool(vault, relayerLibrary, tokensA, {
              poolId: poolIdA,
              userData: data,
              toInternalBalance: false,
              sender: user.address,
              recipient,
              poolKind: PoolKind.WEIGHTED,
            }),
          ])
        ).to.be.revertedWith('Incorrect sender');
      });
    });

    context('when caller is authorized', () => {
      let sender: Account;

      context('sender = user', () => {
        beforeEach(() => {
          sender = user;
        });

        itTestsExit();
      });

      context('sender = relayer', () => {
        beforeEach(() => {
          sender = relayer;
        });

        itTestsExit();
      });

      function itTestsExit() {
        it('stores exit result as chained reference', async () => {
          const result = await queries.queryExit(poolIdA, TypesConverter.toAddress(sender), recipient, {
            assets: tokensA.addresses,
            minAmountsOut,
            toInternalBalance: false,
            userData: data,
          });

          expect(result.bptIn).to.equal(bptIn);
          const expectedAmountsOut = result.amountsOut;
          // sanity check
          expectArrayEqualWithError(expectedAmountsOut, calculatedAmountsOut);

          // Pass an "out of order" reference, to ensure it it is using the index values
          await (
            await relayer.connect(user).vaultActionsQueryMulticall([
              encodeExitPool(vault, relayerLibrary, tokensA, {
                poolId: poolIdA,
                userData: data,
                outputReferences: {
                  DAI: toChainedReference(0),
                  MKR: toChainedReference(3),
                },
                sender,
                recipient,
                toInternalBalance: false,
                poolKind: PoolKind.WEIGHTED,
              }),
            ])
          ).wait();

          await expectChainedReferenceContents(
            relayer,
            toChainedReference(0),
            expectedAmountsOut[tokensA.indexOf(tokensA.DAI)]
          );
          await expectChainedReferenceContents(
            relayer,
            toChainedReference(3),
            expectedAmountsOut[tokensA.indexOf(tokensA.MKR)]
          );
        });
      }
    });
  });

  describe('user balance ops', () => {
    const amountDAI = fp(2);
    const amountSNX = fp(5);

    function encodeManageUserBalance(params: {
      ops: Array<{
        kind: UserBalanceOpKind;
        asset: string;
        amount: BigNumberish;
        sender: Account;
        recipient?: Account;
      }>;
      outputReferences?: OutputReference[];
    }): string {
      return relayerLibrary.interface.encodeFunctionData('manageUserBalance', [
        params.ops.map((op) => ({
          kind: op.kind,
          asset: op.asset,
          amount: op.amount,
          sender: TypesConverter.toAddress(op.sender),
          recipient: op.recipient ?? TypesConverter.toAddress(recipient),
        })),
        0,
        params.outputReferences ?? [],
      ]);
    }

    it('does not allow calls to manageUserBalance', async () => {
      await expect(
        relayer.connect(user).vaultActionsQueryMulticall([
          encodeManageUserBalance({
            ops: [
              { kind: UserBalanceOpKind.DepositInternal, asset: tokens.DAI.address, amount: amountDAI, sender: user },
              { kind: UserBalanceOpKind.DepositInternal, asset: tokens.SNX.address, amount: amountSNX, sender: user },
            ],
            outputReferences: [
              { index: 0, key: toChainedReference(0) },
              { index: 1, key: toChainedReference(1) },
            ],
          }),
        ])
      ).to.be.revertedWith('UNIMPLEMENTED');
    });
  });
});
