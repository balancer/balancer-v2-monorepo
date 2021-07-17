import { times } from 'lodash';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract, ContractTransaction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import TokensDeployer from '@balancer-labs/v2-helpers/src/models/tokens/TokensDeployer';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { encodeExit } from '@balancer-labs/v2-helpers/src/models/pools/mockPool';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';

import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { lastBlockNumber, MONTH } from '@balancer-labs/v2-helpers/src/time';
import { MAX_GAS_LIMIT, MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { arrayAdd, arraySub, BigNumberish, bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { PoolSpecialization, RelayerAuthorization } from '@balancer-labs/balancer-js';

describe('Exit Pool', () => {
  let admin: SignerWithAddress, creator: SignerWithAddress, lp: SignerWithAddress;
  let recipient: SignerWithAddress, relayer: SignerWithAddress;
  let authorizer: Contract, vault: Contract, feesCollector: Contract;
  let allTokens: TokenList;

  const SWAP_FEE_PERCENTAGE = fp(0.1);

  before(async () => {
    [, admin, creator, lp, recipient, relayer] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault & tokens', async () => {
    const WETH = await TokensDeployer.deployToken({ symbol: 'WETH' });

    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address, WETH.address, MONTH, MONTH] });
    vault = vault.connect(lp);
    feesCollector = await deployedAt('ProtocolFeesCollector', await vault.getProtocolFeesCollector());

    const action = await actionId(feesCollector, 'setSwapFeePercentage');
    await authorizer.connect(admin).grantRole(action, admin.address);
    await feesCollector.connect(admin).setSwapFeePercentage(SWAP_FEE_PERCENTAGE);

    allTokens = await TokenList.create(['DAI', 'MKR', 'SNX', 'BAT'], { sorted: true });
    await allTokens.mint({ to: [creator, recipient], amount: bn(100e18) });
    await allTokens.approve({ to: vault, from: [creator, recipient] });
  });

  describe('with general pool', () => {
    itExitsSpecializedPoolCorrectly(PoolSpecialization.GeneralPool, 4);
  });

  describe('with minimal swap info pool', () => {
    itExitsSpecializedPoolCorrectly(PoolSpecialization.MinimalSwapInfoPool, 3);
  });

  describe('with two token pool', () => {
    itExitsSpecializedPoolCorrectly(PoolSpecialization.TwoTokenPool, 2);
  });

  function itExitsSpecializedPoolCorrectly(specialization: PoolSpecialization, tokenAmount: number) {
    let pool: Contract;
    let poolId: string;
    let tokens: TokenList;

    let exitAmounts: BigNumber[];
    let dueProtocolFeeAmounts: BigNumber[];

    function array(value: BigNumberish): BigNumber[] {
      return Array(tokenAmount).fill(bn(value));
    }

    sharedBeforeEach('deploy & register pool', async () => {
      pool = await deploy('MockPool', { args: [vault.address, specialization] });
      poolId = await pool.getPoolId();
    });

    context('with no registered tokens', () => {
      it('reverts', async () => {
        await expect(
          vault.connect(creator).exitPool(poolId, creator.address, ZERO_ADDRESS, {
            assets: [],
            minAmountsOut: [],
            fromInternalBalance: false,
            userData: '0x',
          })
        ).to.be.revertedWith('POOL_NO_TOKENS');
      });
    });

    context('with registered tokens', () => {
      sharedBeforeEach('register tokens', async () => {
        tokens = allTokens.subset(tokenAmount);

        await pool.registerTokens(tokens.addresses, Array(tokenAmount).fill(ZERO_ADDRESS));

        exitAmounts = tokens.addresses.map(
          (_, i) =>
            bn(1e18)
              .mul(i + 1)
              .add(1) // Cannot be evenly divided when calculating protocol fees, exposing the rounding behavior
        );
        dueProtocolFeeAmounts = array(0);

        // Join the Pool from the creator so that it has some tokens to exit and pay protocol fees with
        await vault.connect(creator).joinPool(poolId, creator.address, ZERO_ADDRESS, {
          assets: tokens.addresses,
          maxAmountsIn: array(MAX_UINT256),
          fromInternalBalance: false,
          userData: encodeExit(array(50e18), array(0)),
        });

        // Deposit to Internal Balance from the creator so that the Vault has some additional tokens. Otherwise, tests
        // might fail not because the Vault checks its accounting, but because it is out of tokens to send.
        await vault.connect(creator).manageUserBalance(
          tokens.map((token) => ({
            kind: 0, // deposit
            asset: token.address,
            amount: bn(50e18),
            sender: creator.address,
            recipient: creator.address,
          }))
        );
      });

      type ExitPoolData = {
        poolId?: string;
        tokenAddresses?: string[];
        minAmountsOut?: BigNumberish[];
        toInternalBalance?: boolean;
        exitAmounts?: BigNumberish[];
        dueProtocolFeeAmounts?: BigNumberish[];
        fromRelayer?: boolean;
        signature?: boolean;
      };

      async function exitPool(data: ExitPoolData): Promise<ContractTransaction> {
        const request = {
          assets: data.tokenAddresses ?? tokens.addresses,
          minAmountsOut: data.minAmountsOut ?? array(0),
          toInternalBalance: data.toInternalBalance ?? false,
          userData: encodeExit(data.exitAmounts ?? exitAmounts, data.dueProtocolFeeAmounts ?? dueProtocolFeeAmounts),
        };

        const args = [data.poolId ?? poolId, lp.address, recipient.address, request];
        let calldata = vault.interface.encodeFunctionData('exitPool', args);

        if (data.signature) {
          const nonce = await vault.getNextNonce(lp.address);
          const signature = await RelayerAuthorization.signExitAuthorization(
            vault,
            lp,
            relayer.address,
            calldata,
            MAX_UINT256,
            nonce
          );
          calldata = RelayerAuthorization.encodeCalldataAuthorization(calldata, MAX_UINT256, signature);
        }

        // Hardcoding a gas limit prevents (slow) gas estimation
        return (data.fromRelayer ? relayer : lp).sendTransaction({
          to: vault.address,
          data: calldata,
          gasLimit: MAX_GAS_LIMIT,
        });
      }

      context('when called incorrectly', () => {
        it('reverts if the pool ID does not exist', async () => {
          await expect(exitPool({ poolId: ethers.utils.id('invalid') })).to.be.revertedWith('INVALID_POOL_ID');
        });

        it('reverts if a token is missing in the array', async () => {
          await expect(
            exitPool({ tokenAddresses: tokens.addresses.slice(1), minAmountsOut: array(0).slice(1) })
          ).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        });

        it('reverts if there is one extra token', async () => {
          await expect(
            exitPool({
              tokenAddresses: tokens.addresses.concat(tokens.first.address),
              minAmountsOut: array(0).concat(bn(0)),
            })
          ).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        });

        it('reverts if the tokens list is not sorted', async () => {
          await expect(exitPool({ tokenAddresses: tokens.addresses.reverse() })).to.be.revertedWith('TOKENS_MISMATCH');
        });

        it('reverts if token array is empty', async () => {
          await expect(exitPool({ tokenAddresses: [], minAmountsOut: [] })).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        });

        it('reverts if tokens and amounts length do not match', async () => {
          await expect(exitPool({ minAmountsOut: array(0).slice(1) })).to.be.revertedWith('INPUT_LENGTH_MISMATCH');

          await expect(exitPool({ minAmountsOut: array(0).concat(bn(0)) })).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        });
      });

      context('when called correctly', () => {
        context('with incorrect pool return values', () => {
          it('reverts if exit amounts length does not match token length', async () => {
            // Missing
            await expect(exitPool({ exitAmounts: array(0).slice(1) })).to.be.revertedWith('INPUT_LENGTH_MISMATCH');

            // Extra
            await expect(exitPool({ exitAmounts: array(0).concat(bn(0)) })).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
          });

          it('reverts if due protocol fees length does not match token length', async () => {
            // Missing
            await expect(exitPool({ dueProtocolFeeAmounts: array(0).slice(1) })).to.be.revertedWith(
              'INPUT_LENGTH_MISMATCH'
            );

            // Extra
            await expect(exitPool({ dueProtocolFeeAmounts: array(0).concat(bn(0)) })).to.be.revertedWith(
              'INPUT_LENGTH_MISMATCH'
            );
          });

          it('reverts if exit amounts and due protocol fees length do not match token length', async () => {
            // Missing
            await expect(
              exitPool({ exitAmounts: array(0).slice(1), dueProtocolFeeAmounts: array(0).slice(1) })
            ).to.be.revertedWith('INPUT_LENGTH_MISMATCH');

            // Extra
            await expect(
              exitPool({ exitAmounts: array(0).concat(bn(0)), dueProtocolFeeAmounts: array(0).concat(bn(0)) })
            ).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
          });
        });

        context('with correct pool return values', () => {
          itExitsCorrectlyWithAndWithoutDueProtocolFeesAndInternalBalance();
        });
      });

      function itExitsCorrectlyWithAndWithoutDueProtocolFeesAndInternalBalance() {
        context('with no due protocol fees', () => {
          const dueProtocolFeeAmounts = array(0);

          context('when the sender is the user', () => {
            const fromRelayer = false;

            itExitsCorrectlyWithAndWithoutInternalBalance(dueProtocolFeeAmounts, fromRelayer);
          });

          context('when the sender is a relayer', () => {
            const fromRelayer = true;

            context('when the relayer is whitelisted by the authorizer', () => {
              sharedBeforeEach('grant permission to relayer', async () => {
                const action = await actionId(vault, 'exitPool');
                await authorizer.connect(admin).grantRole(action, relayer.address);
              });

              context('when the relayer is allowed by the user', () => {
                sharedBeforeEach('allow relayer', async () => {
                  await vault.connect(lp).setRelayerApproval(lp.address, relayer.address, true);
                });

                itExitsCorrectlyWithAndWithoutInternalBalance(dueProtocolFeeAmounts, fromRelayer);
              });

              context('when the relayer is not allowed by the user', () => {
                sharedBeforeEach('disallow relayer', async () => {
                  await vault.connect(lp).setRelayerApproval(lp.address, relayer.address, false);
                });

                context('when the relayer is not eternally-allowed by the user', () => {
                  const signature = false;

                  it('reverts', async () => {
                    await expect(exitPool({ dueProtocolFeeAmounts, fromRelayer, signature })).to.be.revertedWith(
                      'USER_DOESNT_ALLOW_RELAYER'
                    );
                  });
                });

                context('when the relayer is allowed by signature', () => {
                  const signature = true;

                  itExitsCorrectlyWithAndWithoutInternalBalance(dueProtocolFeeAmounts, fromRelayer, signature);
                });
              });
            });

            context('when the relayer is not whitelisted by the authorizer', () => {
              sharedBeforeEach('revoke permission from relayer', async () => {
                const action = await actionId(vault, 'exitPool');
                await authorizer.connect(admin).revokeRole(action, relayer.address);
              });

              context('when the relayer is allowed by the user', () => {
                sharedBeforeEach('allow relayer', async () => {
                  await vault.connect(lp).setRelayerApproval(lp.address, relayer.address, true);
                });

                it('reverts', async () => {
                  await expect(exitPool({ dueProtocolFeeAmounts, fromRelayer })).to.be.revertedWith(
                    'SENDER_NOT_ALLOWED'
                  );
                });
              });

              context('when the relayer is not allowed by the user', () => {
                sharedBeforeEach('disallow relayer', async () => {
                  await vault.connect(lp).setRelayerApproval(lp.address, relayer.address, false);
                });

                it('reverts', async () => {
                  await expect(exitPool({ dueProtocolFeeAmounts, fromRelayer })).to.be.revertedWith(
                    'SENDER_NOT_ALLOWED'
                  );
                });
              });
            });
          });
        });

        context('with due protocol fees', () => {
          const dueProtocolFeeAmounts = array(1e18);
          const fromRelayer = false;

          itExitsCorrectlyWithAndWithoutInternalBalance(dueProtocolFeeAmounts, fromRelayer);
        });
      }

      function itExitsCorrectlyWithAndWithoutInternalBalance(
        dueProtocolFeeAmounts: BigNumberish[],
        fromRelayer: boolean,
        signature?: boolean
      ) {
        context('not using internal balance', () => {
          const toInternalBalance = false;

          context('without internal balance', () => {
            itExitsCorrectlyDespitePause(dueProtocolFeeAmounts, fromRelayer, toInternalBalance, signature);
          });

          context('with some internal balance', () => {
            sharedBeforeEach('deposit to internal balance', async () => {
              await vault.connect(recipient).manageUserBalance(
                tokens.map((token) => ({
                  kind: 0, // deposit
                  asset: token.address,
                  amount: bn(1.5e18),
                  sender: recipient.address,
                  recipient: recipient.address,
                }))
              );
            });

            itExitsCorrectlyDespitePause(dueProtocolFeeAmounts, fromRelayer, toInternalBalance, signature);
          });
        });

        context('using internal balance', () => {
          const toInternalBalance = true;

          context('with no internal balance', () => {
            itExitsCorrectlyDespitePause(dueProtocolFeeAmounts, fromRelayer, toInternalBalance, signature);
          });

          context('with some internal balance', () => {
            sharedBeforeEach('deposit to internal balance', async () => {
              await vault.connect(recipient).manageUserBalance(
                tokens.map((token) => ({
                  kind: 0, // deposit
                  asset: token.address,
                  amount: bn(1.5e18),
                  sender: recipient.address,
                  recipient: recipient.address,
                }))
              );
            });

            itExitsCorrectlyDespitePause(dueProtocolFeeAmounts, fromRelayer, toInternalBalance, signature);
          });
        });
      }

      function itExitsCorrectlyDespitePause(
        dueProtocolFeeAmounts: BigNumberish[],
        fromRelayer: boolean,
        toInternalBalance: boolean,
        signature?: boolean
      ) {
        context('when unpaused', () => {
          itExitsCorrectly(dueProtocolFeeAmounts, fromRelayer, toInternalBalance, signature);
        });

        context('when paused', () => {
          sharedBeforeEach('pause', async () => {
            const action = await actionId(vault, 'setPaused');
            await authorizer.connect(admin).grantRole(action, admin.address);
            await vault.connect(admin).setPaused(true);
          });

          itExitsCorrectly(dueProtocolFeeAmounts, fromRelayer, toInternalBalance, signature);
        });

        function itExitsCorrectly(
          dueProtocolFeeAmounts: BigNumberish[],
          fromRelayer: boolean,
          toInternalBalance: boolean,
          signature?: boolean
        ) {
          it('sends tokens from the vault to the recipient', async () => {
            // Tokens are sent to the recipient, so the expected change is positive
            const expectedUserChanges = toInternalBalance ? array(0) : exitAmounts;
            const recipientChanges = tokens.reduce(
              (changes, token, i) => ({ ...changes, [token.symbol]: expectedUserChanges[i] }),
              {}
            );

            const expectedVaultChanges = toInternalBalance
              ? dueProtocolFeeAmounts
              : arrayAdd(exitAmounts, dueProtocolFeeAmounts);

            const vaultChanges = tokens.reduce(
              // Tokens are sent from the Vault, so the expected change is negative
              (changes, token, i) => ({ ...changes, [token.symbol]: bn(expectedVaultChanges[i]).mul(-1) }),
              {}
            );

            // Tokens are sent to the Protocol Fees, so the expected change is positive
            const protocolFeesChanges = tokens.reduce(
              (changes, token, i) => ({ ...changes, [token.symbol]: dueProtocolFeeAmounts[i] }),
              {}
            );

            await expectBalanceChange(
              () => exitPool({ dueProtocolFeeAmounts, fromRelayer, toInternalBalance, signature }),
              tokens,
              [
                { account: vault, changes: vaultChanges },
                { account: recipient, changes: recipientChanges },
                { account: feesCollector, changes: protocolFeesChanges },
              ]
            );
          });

          it('assigns internal balance to the recipient', async () => {
            const previousInternalBalances = await vault.getInternalBalance(recipient.address, tokens.addresses);
            await exitPool({ dueProtocolFeeAmounts, fromRelayer, toInternalBalance, signature });
            const currentInternalBalances = await vault.getInternalBalance(recipient.address, tokens.addresses);

            // Internal balance is expected to increase: current - previous should equal expected.
            const expectedInternalBalanceIncrease = toInternalBalance ? exitAmounts : array(0);
            expect(arraySub(currentInternalBalances, previousInternalBalances)).to.deep.equal(
              expectedInternalBalanceIncrease
            );
          });

          it('deducts tokens from the pool', async () => {
            const { balances: previousPoolBalances } = await vault.getPoolTokens(poolId);
            await exitPool({ dueProtocolFeeAmounts, fromRelayer, toInternalBalance, signature });
            const { balances: currentPoolBalances } = await vault.getPoolTokens(poolId);

            // The Pool balance is expected to decrease by exit amounts plus due protocol fees.
            expect(arraySub(previousPoolBalances, currentPoolBalances)).to.deep.equal(
              arrayAdd(exitAmounts, dueProtocolFeeAmounts)
            );
          });

          it('calls the pool with the exit data', async () => {
            const { balances: previousPoolBalances } = await vault.getPoolTokens(poolId);
            const { lastChangeBlock: previousBlockNumber } = await vault.getPoolTokenInfo(poolId, tokens.first.address);

            const receipt = await (
              await exitPool({ dueProtocolFeeAmounts, fromRelayer, toInternalBalance, signature })
            ).wait();

            expectEvent.inIndirectReceipt(receipt, pool.interface, 'OnExitPoolCalled', {
              poolId,
              sender: lp.address,
              recipient: recipient.address,
              currentBalances: previousPoolBalances,
              protocolSwapFeePercentage: await feesCollector.getSwapFeePercentage(),
              lastChangeBlock: previousBlockNumber,
              userData: encodeExit(exitAmounts, dueProtocolFeeAmounts),
            });
          });

          it('updates the last change block used for all tokens', async () => {
            const currentBlockNumber = await lastBlockNumber();

            await exitPool({ dueProtocolFeeAmounts, fromRelayer, toInternalBalance, signature });

            await tokens.asyncEach(async (token: Token) => {
              const { lastChangeBlock: newBlockNumber } = await vault.getPoolTokenInfo(poolId, token.address);
              expect(newBlockNumber).to.equal(currentBlockNumber + 1);
            });
          });

          it('emits PoolBalanceChanged from the vault', async () => {
            const receipt = await (
              await exitPool({ dueProtocolFeeAmounts, fromRelayer, toInternalBalance, signature })
            ).wait();

            expectEvent.inIndirectReceipt(receipt, vault.interface, 'PoolBalanceChanged', {
              poolId,
              liquidityProvider: lp.address,
              deltas: exitAmounts.map((amount) => amount.mul(-1)),
              protocolFeeAmounts: dueProtocolFeeAmounts,
            });
          });

          it('collects protocol fees', async () => {
            const previousCollectedFees = await feesCollector.getCollectedFeeAmounts(tokens.addresses);
            await exitPool({ dueProtocolFeeAmounts, fromRelayer, toInternalBalance, signature });
            const currentCollectedFees = await feesCollector.getCollectedFeeAmounts(tokens.addresses);

            // Fees from both sources are lumped together.
            expect(arraySub(currentCollectedFees, previousCollectedFees)).to.deep.equal(dueProtocolFeeAmounts);
          });

          it('exits multiple times', async () => {
            await Promise.all(
              times(3, () => async () => {
                const receipt = await (await exitPool({ toInternalBalance, dueProtocolFeeAmounts, signature })).wait();
                expectEvent.inIndirectReceipt(receipt, pool.interface, 'OnExitPoolCalled');
              })
            );
          });

          it('exits the pool fully', async () => {
            const { balances: poolBalances } = await vault.getPoolTokens(poolId);
            const fullExitAmounts = arraySub(poolBalances, dueProtocolFeeAmounts);

            await exitPool({
              dueProtocolFeeAmounts,
              fromRelayer,
              toInternalBalance,
              exitAmounts: fullExitAmounts,
              signature,
            });

            const { balances: currentBalances } = await vault.getPoolTokens(poolId);
            expect(currentBalances).to.deep.equal(array(0));
          });

          it('reverts if any of the min amounts out is not enough', async () => {
            await Promise.all(
              exitAmounts.map((amount, i) => {
                const minAmountsOut = array(0);
                minAmountsOut[i] = amount.add(1);

                return expect(
                  exitPool({ dueProtocolFeeAmounts, fromRelayer, toInternalBalance, minAmountsOut, signature })
                ).to.be.revertedWith('EXIT_BELOW_MIN');
              })
            );
          });

          it('reverts if any of the amounts to exit plus fees is larger than the pool balance', async () => {
            const { balances: poolBalances } = await vault.getPoolTokens(poolId);

            await Promise.all(
              poolBalances.map((balance: BigNumber, i: number) => {
                const excessiveExitAmounts = [...exitAmounts];
                excessiveExitAmounts[i] = balance.sub(dueProtocolFeeAmounts[i]).add(1);

                return expect(
                  exitPool({
                    dueProtocolFeeAmounts,
                    fromRelayer,
                    toInternalBalance,
                    exitAmounts: excessiveExitAmounts,
                    signature,
                  })
                ).to.be.revertedWith('SUB_OVERFLOW');
              })
            );
          });
        }
      }
    });
  }
});
