import { times } from 'lodash';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract, ContractTransaction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import TokensDeployer from '@balancer-labs/v2-helpers/src/models/tokens/TokensDeployer';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { encodeJoin } from '@balancer-labs/v2-helpers/src/models/pools/mockPool';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';

import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { lastBlockNumber, MONTH } from '@balancer-labs/v2-helpers/src/time';
import { MAX_GAS_LIMIT, MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { arraySub, bn, BigNumberish, min, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { PoolSpecialization, RelayerAuthorization } from '@balancer-labs/balancer-js';

describe('Join Pool', () => {
  let admin: SignerWithAddress, creator: SignerWithAddress, lp: SignerWithAddress, relayer: SignerWithAddress;
  let authorizer: Contract, vault: Contract, feesCollector: Contract;
  let allTokens: TokenList;

  before(async () => {
    [, admin, creator, lp, relayer] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault & tokens', async () => {
    const WETH = await TokensDeployer.deployToken({ symbol: 'WETH' });

    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address, WETH.address, MONTH, MONTH] });
    feesCollector = await deployedAt('ProtocolFeesCollector', await vault.getProtocolFeesCollector());

    const action = await actionId(feesCollector, 'setSwapFeePercentage');
    await authorizer.connect(admin).grantRole(action, admin.address);
    await feesCollector.connect(admin).setSwapFeePercentage(fp(0.1));

    allTokens = await TokenList.create(['DAI', 'MKR', 'SNX', 'BAT'], { sorted: true });
    await allTokens.mint({ to: [creator, lp], amount: bn(100e18) });
    await allTokens.approve({ to: vault, from: [creator, lp] });
  });

  describe('with general pool', () => {
    itJoinsSpecializedPoolCorrectly(PoolSpecialization.GeneralPool, 4);
  });

  describe('with minimal swap info pool', () => {
    itJoinsSpecializedPoolCorrectly(PoolSpecialization.MinimalSwapInfoPool, 3);
  });

  describe('with two token pool', () => {
    itJoinsSpecializedPoolCorrectly(PoolSpecialization.TwoTokenPool, 2);
  });

  function itJoinsSpecializedPoolCorrectly(specialization: PoolSpecialization, tokenAmount: number) {
    let pool: Contract;
    let poolId: string;
    let tokens: TokenList;

    let joinAmounts: BigNumber[];
    let DUE_PROTOCOL_FEE_AMOUNTS: BigNumber[];

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
          vault.connect(creator).joinPool(poolId, creator.address, ZERO_ADDRESS, {
            assets: [],
            maxAmountsIn: [],
            fromInternalBalance: false,
            userData: '0x',
          })
        ).to.be.revertedWith('POOL_NO_TOKENS');
      });
    });

    context('with registered tokens', () => {
      sharedBeforeEach('register tokens', async () => {
        tokens = await allTokens.subset(tokenAmount);

        await pool.registerTokens(tokens.addresses, Array(tokenAmount).fill(ZERO_ADDRESS));

        joinAmounts = tokens.addresses.map((_, i) => bn(1e18).mul(i + 1));
        DUE_PROTOCOL_FEE_AMOUNTS = array(0);

        // Join the Pool from the creator so that it has some tokens to pay protocol fees with
        await vault.connect(creator).joinPool(poolId, creator.address, ZERO_ADDRESS, {
          assets: tokens.addresses,
          maxAmountsIn: array(MAX_UINT256),
          fromInternalBalance: false,
          userData: encodeJoin(array(50e18), array(0)),
        });
      });

      type JoinPoolData = {
        poolId?: string;
        tokenAddresses?: string[];
        maxAmountsIn?: BigNumberish[];
        fromInternalBalance?: boolean;
        joinAmounts?: BigNumberish[];
        dueProtocolFeeAmounts?: BigNumberish[];
        fromRelayer?: boolean;
        signature?: boolean;
      };

      async function joinPool(data: JoinPoolData = {}): Promise<ContractTransaction> {
        const request = {
          assets: data.tokenAddresses ?? tokens.addresses,
          maxAmountsIn: data.maxAmountsIn ?? array(MAX_UINT256),
          fromInternalBalance: data.fromInternalBalance ?? false,
          userData: encodeJoin(data.joinAmounts ?? joinAmounts, data.dueProtocolFeeAmounts ?? DUE_PROTOCOL_FEE_AMOUNTS),
        };

        const args = [data.poolId ?? poolId, lp.address, ZERO_ADDRESS, request];
        let calldata = vault.interface.encodeFunctionData('joinPool', args);

        if (data.signature) {
          const nonce = await vault.getNextNonce(lp.address);
          const signature = await RelayerAuthorization.signJoinAuthorization(
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
          await expect(joinPool({ poolId: ethers.utils.id('invalid') })).to.be.revertedWith('INVALID_POOL_ID');
        });

        it('reverts if a token is missing in the array', async () => {
          await expect(
            joinPool({ tokenAddresses: tokens.addresses.slice(1), maxAmountsIn: array(0).slice(1) })
          ).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        });

        it('reverts if there is one extra token', async () => {
          await expect(
            joinPool({
              tokenAddresses: tokens.addresses.concat(tokens.first.address),
              maxAmountsIn: array(0).concat(bn(0)),
            })
          ).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        });

        it('reverts if the tokens list is not sorted', async () => {
          await expect(joinPool({ tokenAddresses: tokens.addresses.reverse() })).to.be.revertedWith('TOKENS_MISMATCH');
        });

        it('reverts if token array is empty', async () => {
          await expect(joinPool({ tokenAddresses: [], maxAmountsIn: [] })).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        });

        it('reverts if tokens and amounts length do not match', async () => {
          await expect(joinPool({ maxAmountsIn: array(0).slice(1) })).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
          await expect(joinPool({ maxAmountsIn: array(0).concat(bn(0)) })).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        });
      });

      context('when called correctly', () => {
        context('with incorrect pool return values', () => {
          it('reverts if join amounts length does not match token length', async () => {
            // Missing
            await expect(joinPool({ joinAmounts: array(0).slice(1) })).to.be.revertedWith('INPUT_LENGTH_MISMATCH');

            // Extra
            await expect(joinPool({ joinAmounts: array(0).concat(bn(0)) })).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
          });

          it('reverts if due protocol fees length does not match token length', async () => {
            // Missing
            await expect(joinPool({ dueProtocolFeeAmounts: array(0).slice(1) })).to.be.revertedWith(
              'INPUT_LENGTH_MISMATCH'
            );

            // Extra
            await expect(joinPool({ dueProtocolFeeAmounts: array(0).concat(bn(0)) })).to.be.revertedWith(
              'INPUT_LENGTH_MISMATCH'
            );
          });

          it('reverts if join amounts and due protocol fees length do not match token length', async () => {
            // Missing
            await expect(
              joinPool({ joinAmounts: array(0).slice(1), dueProtocolFeeAmounts: array(0).slice(1) })
            ).to.be.revertedWith('INPUT_LENGTH_MISMATCH');

            // Extra
            await expect(
              joinPool({ joinAmounts: array(0).concat(bn(0)), dueProtocolFeeAmounts: array(0).concat(bn(0)) })
            ).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
          });
        });

        context('with correct pool return values', () => {
          context('when unpaused', () => {
            context('with no due protocol fees', () => {
              const dueProtocolFeeAmounts = array(0);

              context('when the sender is the user', () => {
                const fromRelayer = false;

                itJoinsCorrectlyWithAndWithoutInternalBalance(dueProtocolFeeAmounts, fromRelayer);
              });

              context('when the sender is a relayer', () => {
                const fromRelayer = true;

                context('when the relayer is whitelisted by the authorizer', () => {
                  sharedBeforeEach('grant permission to relayer', async () => {
                    const action = await actionId(vault, 'joinPool');
                    await authorizer.connect(admin).grantRole(action, relayer.address);
                  });

                  context('when the relayer is allowed by the user', () => {
                    sharedBeforeEach('allow relayer', async () => {
                      await vault.connect(lp).setRelayerApproval(lp.address, relayer.address, true);
                    });

                    itJoinsCorrectlyWithAndWithoutInternalBalance(dueProtocolFeeAmounts, fromRelayer);
                  });

                  context('when the relayer is not allowed by the user', () => {
                    sharedBeforeEach('disallow relayer', async () => {
                      await vault.connect(lp).setRelayerApproval(lp.address, relayer.address, false);
                    });

                    context('when the relayer is not eternally-allowed by the user', () => {
                      const signature = false;

                      it('reverts', async () => {
                        await expect(joinPool({ dueProtocolFeeAmounts, fromRelayer, signature })).to.be.revertedWith(
                          'USER_DOESNT_ALLOW_RELAYER'
                        );
                      });
                    });

                    context('when the relayer is allowed by signature', () => {
                      const signature = true;

                      itJoinsCorrectlyWithAndWithoutInternalBalance(dueProtocolFeeAmounts, fromRelayer, signature);
                    });
                  });
                });

                context('when the relayer is not whitelisted by the authorizer', () => {
                  sharedBeforeEach('revoke permission from relayer', async () => {
                    const action = await actionId(vault, 'joinPool');
                    await authorizer.connect(admin).revokeRole(action, relayer.address);
                  });

                  context('when the relayer is allowed by the user', () => {
                    sharedBeforeEach('allow relayer', async () => {
                      await vault.connect(lp).setRelayerApproval(lp.address, relayer.address, true);
                    });

                    it('reverts', async () => {
                      await expect(joinPool({ dueProtocolFeeAmounts, fromRelayer })).to.be.revertedWith(
                        'SENDER_NOT_ALLOWED'
                      );
                    });
                  });

                  context('when the relayer is not allowed by the user', () => {
                    sharedBeforeEach('disallow relayer', async () => {
                      await vault.connect(lp).setRelayerApproval(lp.address, relayer.address, false);
                    });

                    it('reverts', async () => {
                      await expect(joinPool({ dueProtocolFeeAmounts, fromRelayer })).to.be.revertedWith(
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

              itJoinsCorrectlyWithAndWithoutInternalBalance(dueProtocolFeeAmounts, fromRelayer);
            });
          });

          context('when paused', () => {
            sharedBeforeEach('pause', async () => {
              const action = await actionId(vault, 'setPaused');
              await authorizer.connect(admin).grantRole(action, admin.address);
              await vault.connect(admin).setPaused(true);
            });

            it('reverts', async () => {
              await expect(joinPool()).to.be.revertedWith('PAUSED');
            });
          });
        });
      });

      function itJoinsCorrectlyWithAndWithoutInternalBalance(
        dueProtocolFeeAmounts: BigNumberish[],
        fromRelayer: boolean,
        signature?: boolean
      ) {
        context('not using internal balance', () => {
          const fromInternalBalance = false;

          context('with no internal balance', () => {
            itJoinsCorrectly(dueProtocolFeeAmounts, fromRelayer, fromInternalBalance, signature);
          });

          context('with some internal balance', () => {
            sharedBeforeEach('deposit to internal balance', async () => {
              await vault.connect(lp).manageUserBalance(
                tokens.map((token) => ({
                  kind: 0, // deposit
                  asset: token.address,
                  amount: bn(1.5e18),
                  sender: lp.address,
                  recipient: lp.address,
                }))
              );
            });

            itJoinsCorrectly(dueProtocolFeeAmounts, fromRelayer, fromInternalBalance, signature);
          });
        });

        context('using internal balance', () => {
          const fromInternalBalance = true;

          context('with no internal balance', () => {
            itJoinsCorrectly(dueProtocolFeeAmounts, fromRelayer, fromInternalBalance, signature);
          });

          context('with some internal balance', () => {
            sharedBeforeEach('deposit to internal balance', async () => {
              await vault.connect(lp).manageUserBalance(
                tokens.map((token) => ({
                  kind: 0, // deposit
                  asset: token.address,
                  amount: bn(1.5e18),
                  sender: lp.address,
                  recipient: lp.address,
                }))
              );
            });

            itJoinsCorrectly(dueProtocolFeeAmounts, fromRelayer, fromInternalBalance, signature);
          });

          context('with enough internal balance', () => {
            sharedBeforeEach('deposit to internal balance', async () => {
              await vault.connect(lp).manageUserBalance(
                tokens.map((token) => ({
                  kind: 0, // deposit
                  asset: token.address,
                  amount: bn(1.5e18),
                  sender: lp.address,
                  recipient: lp.address,
                }))
              );
            });

            itJoinsCorrectly(dueProtocolFeeAmounts, fromRelayer, fromInternalBalance, signature);
          });
        });
      }

      function itJoinsCorrectly(
        dueProtocolFeeAmounts: BigNumberish[],
        fromRelayer: boolean,
        fromInternalBalance: boolean,
        signature?: boolean
      ) {
        let expectedInternalBalanceToUse: BigNumber[];

        sharedBeforeEach('calculate intermediate values', async () => {
          const currentInternalBalances: BigNumber[] = await vault.getInternalBalance(lp.address, tokens.addresses);

          expectedInternalBalanceToUse = currentInternalBalances.map((balance, i) =>
            // If withdrawing from internal balance, the amount to withdraw is limited by the lower of the current
            // balance and the actual join amount.
            fromInternalBalance ? min(balance, joinAmounts[i]) : bn(0)
          );
        });

        it('takes tokens from the LP into the vault', async () => {
          // Tokens are sent from the LP, so the expected change is negative
          const expectedTransferAmounts = arraySub(joinAmounts, expectedInternalBalanceToUse);
          const lpChanges = tokens.reduce(
            (changes, token, i) => ({ ...changes, [token.symbol]: expectedTransferAmounts[i].mul(-1) }),
            {}
          );

          // Tokens are sent to the Vault, so the expected change is positive
          const expectedVaultChanges = arraySub(expectedTransferAmounts, dueProtocolFeeAmounts);
          const vaultChanges = tokens.reduce(
            (changes, token, i) => ({ ...changes, [token.symbol]: expectedVaultChanges[i] }),
            {}
          );

          // Tokens are sent to the Protocol Fees, so the expected change is positive
          const protocolFeesChanges = tokens.reduce(
            (changes, token, i) => ({ ...changes, [token.symbol]: dueProtocolFeeAmounts[i] }),
            {}
          );

          await expectBalanceChange(
            () => joinPool({ dueProtocolFeeAmounts, fromRelayer, fromInternalBalance, signature }),
            allTokens,
            [
              { account: lp, changes: lpChanges },
              { account: vault, changes: vaultChanges },
              { account: feesCollector, changes: protocolFeesChanges },
            ]
          );
        });

        it('deducts internal balance from the LP', async () => {
          const previousInternalBalances = await vault.getInternalBalance(lp.address, tokens.addresses);
          await joinPool({ dueProtocolFeeAmounts, fromRelayer, fromInternalBalance, signature });
          const currentInternalBalances = await vault.getInternalBalance(lp.address, tokens.addresses);

          // Internal balance is expected to decrease: previous - current should equal expected.
          expect(arraySub(previousInternalBalances, currentInternalBalances)).to.deep.equal(
            expectedInternalBalanceToUse
          );
        });

        it('assigns tokens to the pool', async () => {
          const { balances: previousPoolBalances } = await vault.getPoolTokens(poolId);
          await joinPool({ dueProtocolFeeAmounts, fromRelayer, fromInternalBalance, signature });
          const { balances: currentPoolBalances } = await vault.getPoolTokens(poolId);

          // The Pool balance is expected to increase by join amounts minus due protocol fees. Note that the deltas are
          // not necessarily positive, if the fees due are larger than the join amounts.
          expect(arraySub(currentPoolBalances, previousPoolBalances)).to.deep.equal(
            arraySub(joinAmounts, dueProtocolFeeAmounts)
          );
        });

        it('calls the pool with the join data', async () => {
          const { balances: previousPoolBalances } = await vault.getPoolTokens(poolId);
          const { lastChangeBlock: previousBlockNumber } = await vault.getPoolTokenInfo(poolId, tokens.first.address);

          const receipt = await (
            await joinPool({ dueProtocolFeeAmounts, fromRelayer, fromInternalBalance, signature })
          ).wait();

          expectEvent.inIndirectReceipt(receipt, pool.interface, 'OnJoinPoolCalled', {
            poolId,
            sender: lp.address,
            recipient: ZERO_ADDRESS,
            currentBalances: previousPoolBalances,
            lastChangeBlock: previousBlockNumber,
            protocolSwapFeePercentage: await feesCollector.getSwapFeePercentage(),
            userData: encodeJoin(joinAmounts, dueProtocolFeeAmounts),
          });
        });

        it('updates the last change block used for all tokens', async () => {
          const currentBlockNumber = await lastBlockNumber();

          await joinPool({ dueProtocolFeeAmounts, fromRelayer, fromInternalBalance, signature });

          await tokens.asyncEach(async (token: Token) => {
            const { lastChangeBlock: newBlockNumber } = await vault.getPoolTokenInfo(poolId, token.address);
            expect(newBlockNumber).to.equal(currentBlockNumber + 1);
          });
        });

        it('emits PoolBalanceChanged from the vault', async () => {
          const receipt = await (
            await joinPool({ dueProtocolFeeAmounts, fromRelayer, fromInternalBalance, signature })
          ).wait();

          expectEvent.inIndirectReceipt(receipt, vault.interface, 'PoolBalanceChanged', {
            poolId,
            liquidityProvider: lp.address,
            deltas: joinAmounts,
            protocolFeeAmounts: dueProtocolFeeAmounts,
          });
        });

        it('collects protocol fees', async () => {
          const previousCollectedFees: BigNumber[] = await feesCollector.getCollectedFeeAmounts(tokens.addresses);
          await joinPool({ dueProtocolFeeAmounts, fromRelayer, fromInternalBalance, signature });
          const currentCollectedFees: BigNumber[] = await feesCollector.getCollectedFeeAmounts(tokens.addresses);

          expect(arraySub(currentCollectedFees, previousCollectedFees)).to.deep.equal(dueProtocolFeeAmounts);
        });

        it('joins multiple times', async () => {
          await Promise.all(
            times(3, () => async () => {
              const receipt = await (
                await joinPool({ dueProtocolFeeAmounts, fromRelayer, fromInternalBalance, signature })
              ).wait();
              expectEvent.inIndirectReceipt(receipt, pool.interface, 'OnJoinPoolCalled');
            })
          );
        });

        it('reverts if any of the max amounts in is not enough', async () => {
          await Promise.all(
            joinAmounts.map((amount, i) => {
              if (amount.gt(0)) {
                const maxAmountsIn = array(MAX_UINT256);
                maxAmountsIn[i] = amount.sub(1);

                return expect(
                  joinPool({ dueProtocolFeeAmounts, fromRelayer, fromInternalBalance, signature, maxAmountsIn })
                ).to.be.revertedWith('JOIN_ABOVE_MAX');
              }
            })
          );
        });

        it('reverts if any of the amounts to transfer is larger than lp balance', async () => {
          const expectedTokensToTransfer = arraySub(joinAmounts, expectedInternalBalanceToUse);

          await tokens.asyncEach(async (token: Token, i: number) => {
            const amount = expectedTokensToTransfer[i];
            if (amount.gt(0)) {
              // Burn excess balance so that the LP is missing one token to join
              const currentBalance = await token.balanceOf(lp.address);
              await token.burn(currentBalance.sub(amount).add(1), { from: lp });

              return expect(
                joinPool({ dueProtocolFeeAmounts, fromRelayer, fromInternalBalance, signature })
              ).to.be.revertedWith('ERC20_TRANSFER_EXCEEDS_BALANCE');
            }
          });
        });
      }
    });
  }
});
