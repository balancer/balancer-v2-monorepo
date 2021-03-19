import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Dictionary } from 'lodash';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Token from '../helpers/models/tokens/Token';
import TokenList from '../helpers/models/tokens/TokenList';
import * as expectEvent from '../helpers/expectEvent';
import { expectBalanceChange } from '../helpers/tokenBalance';

import { NAry } from '../helpers/models/types/types';
import { roleId } from '../../lib/helpers/roles';
import { deploy } from '../../lib/helpers/deploy';
import { bn, fp, pct } from '../../lib/helpers/numbers';
import { ZERO_ADDRESS } from '../../lib/helpers/constants';
import TokensDeployer from '../helpers/models/tokens/TokensDeployer';

describe('Vault - internal balance', () => {
  let admin: SignerWithAddress, sender: SignerWithAddress, recipient: SignerWithAddress;
  let relayer: SignerWithAddress, otherRecipient: SignerWithAddress;
  let authorizer: Contract, vault: Contract;
  let tokens: TokenList;

  const WITHDRAW_FEE = 0.005;

  before('setup signers', async () => {
    [, admin, sender, recipient, otherRecipient, relayer] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault & tokens', async () => {
    tokens = await TokenList.create(['DAI', 'MKR']);
    const WETH = await TokensDeployer.deployToken({ symbol: 'WETH' });

    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address, WETH.address, 0, 0] });
  });

  sharedBeforeEach('set withdraw fee', async () => {
    const role = await roleId(vault, 'setProtocolFees');
    await authorizer.connect(admin).grantRole(role, admin.address);
    await vault.connect(admin).setProtocolFees(0, fp(WITHDRAW_FEE), 0);
  });

  describe('deposit', () => {
    const initialBalance = bn(10);

    const itHandlesDepositsProperly = (amount: BigNumber) => {
      it('transfers the tokens from the sender to the vault', async () => {
        await expectBalanceChange(
          () =>
            vault.depositToInternalBalance([
              { token: tokens.DAI.address, amount: amount, sender: sender.address, recipient: recipient.address },
            ]),
          tokens,
          [
            { account: sender.address, changes: { DAI: -amount } },
            { account: vault.address, changes: { DAI: amount } },
          ]
        );
      });

      it('deposits the internal balance into the recipient account', async () => {
        const previousSenderBalance = await vault.getInternalBalance(sender.address, [tokens.DAI.address]);
        const previousRecipientBalance = await vault.getInternalBalance(recipient.address, [tokens.DAI.address]);

        await vault.depositToInternalBalance([
          { token: tokens.DAI.address, amount: amount, sender: sender.address, recipient: recipient.address },
        ]);

        const currentSenderBalance = await vault.getInternalBalance(sender.address, [tokens.DAI.address]);
        expect(currentSenderBalance[0]).to.be.equal(previousSenderBalance[0]);

        const currentRecipientBalance = await vault.getInternalBalance(recipient.address, [tokens.DAI.address]);
        expect(currentRecipientBalance[0]).to.be.equal(previousRecipientBalance[0].add(amount));
      });

      it('emits an event', async () => {
        const receipt = await (
          await vault.depositToInternalBalance([
            { token: tokens.DAI.address, amount: amount, sender: sender.address, recipient: recipient.address },
          ])
        ).wait();

        expectEvent.inReceipt(receipt, 'InternalBalanceChanged', {
          user: recipient.address,
          token: tokens.DAI.address,
          balance: amount,
        });
      });
    };

    context('when the sender is the user', () => {
      beforeEach('set sender', () => {
        vault = vault.connect(sender);
      });

      context('when the token is not the zero address', () => {
        context('when the sender does hold enough balance', () => {
          sharedBeforeEach('mint tokens', async () => {
            await tokens.DAI.mint(sender, initialBalance);
          });

          context('when the given amount is approved by the sender', () => {
            sharedBeforeEach('approve tokens', async () => {
              await tokens.DAI.approve(vault.address, initialBalance, { from: sender });
            });

            context('when tokens and balances match', () => {
              context('when depositing zero balance', () => {
                const depositAmount = bn(0);

                itHandlesDepositsProperly(depositAmount);
              });

              context('when depositing some balance', () => {
                const depositAmount = initialBalance;

                itHandlesDepositsProperly(depositAmount);
              });
            });
          });

          context('when the given amount is not approved by the sender', () => {
            it('reverts', async () => {
              await expect(
                vault.depositToInternalBalance([
                  {
                    token: tokens.DAI.address,
                    amount: initialBalance,
                    sender: sender.address,
                    recipient: recipient.address,
                  },
                ])
              ).to.be.revertedWith('ERC20: transfer amount exceeds allowance');
            });
          });
        });

        context('when the sender does not hold enough balance', () => {
          it('reverts', async () => {
            await expect(
              vault.depositToInternalBalance([
                {
                  token: tokens.DAI.address,
                  amount: initialBalance,
                  sender: sender.address,
                  recipient: recipient.address,
                },
              ])
            ).to.be.revertedWith('ERC20: transfer amount exceeds balance');
          });
        });
      });

      context('when the token is the zero address', () => {
        it('reverts', async () => {
          await expect(
            vault.depositToInternalBalance([
              { token: ZERO_ADDRESS, amount: initialBalance, sender: sender.address, recipient: recipient.address },
            ])
          ).to.be.revertedWith('Address: call to non-contract');
        });
      });
    });

    context('when the sender is a relayer', () => {
      beforeEach('set sender', () => {
        vault = vault.connect(relayer);
      });

      sharedBeforeEach('mint tokens for sender', async () => {
        await tokens.DAI.mint(sender, initialBalance);
        await tokens.DAI.approve(vault, initialBalance, { from: sender });
      });

      context('when the relayer is whitelisted by the authorizer', () => {
        sharedBeforeEach('grant role to relayer', async () => {
          const role = roleId(vault, 'depositToInternalBalance');
          await authorizer.connect(admin).grantRole(role, relayer.address);
        });

        context('when the relayer is allowed to deposit by the user', () => {
          sharedBeforeEach('allow relayer', async () => {
            await vault.connect(sender).changeRelayerAllowance(relayer.address, true);
          });

          itHandlesDepositsProperly(initialBalance);
        });

        context('when the relayer is not allowed by the user', () => {
          it('reverts', async () => {
            await expect(
              vault.depositToInternalBalance([
                {
                  token: tokens.DAI.address,
                  amount: initialBalance,
                  sender: sender.address,
                  recipient: recipient.address,
                },
              ])
            ).to.be.revertedWith('USER_DOESNT_ALLOW_RELAYER');
          });
        });
      });

      context('when the relayer is not whitelisted by the authorizer', () => {
        context('when the relayer is allowed by the user', () => {
          sharedBeforeEach('allow relayer', async () => {
            await vault.connect(sender).changeRelayerAllowance(relayer.address, true);
          });

          it('reverts', async () => {
            await expect(
              vault.depositToInternalBalance([
                {
                  token: tokens.DAI.address,
                  amount: initialBalance,
                  sender: sender.address,
                  recipient: recipient.address,
                },
              ])
            ).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });
        });

        context('when the relayer is not allowed by the user', () => {
          sharedBeforeEach('disallow relayer', async () => {
            await vault.connect(sender).changeRelayerAllowance(relayer.address, false);
          });

          it('reverts', async () => {
            await expect(
              vault.depositToInternalBalance([
                {
                  token: tokens.DAI.address,
                  amount: initialBalance,
                  sender: sender.address,
                  recipient: recipient.address,
                },
              ])
            ).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });
        });
      });
    });
  });

  describe('withdraw', () => {
    const depositedAmount = fp(100);

    const itHandlesWithdrawalsProperly = (initialBalance: BigNumber, amount: BigNumber) => {
      context('when tokens and balances match', () => {
        context('without protocol withdraw fees', () => {
          sharedBeforeEach('remove withdraw fee', async () => {
            await vault.connect(admin).setProtocolFees(0, 0, 0);
          });

          it('transfers the tokens from the vault to recipient', async () => {
            await expectBalanceChange(
              () =>
                vault.withdrawFromInternalBalance([
                  { token: tokens.DAI.address, amount: amount, sender: sender.address, recipient: recipient.address },
                ]),
              tokens,
              { account: recipient, changes: { DAI: amount } }
            );
          });

          it('withdraws the internal balance from the sender account', async () => {
            const previousSenderBalance = await vault.getInternalBalance(sender.address, [tokens.DAI.address]);
            const previousRecipientBalance = await vault.getInternalBalance(recipient.address, [tokens.DAI.address]);

            await vault.withdrawFromInternalBalance([
              { token: tokens.DAI.address, amount: amount, sender: sender.address, recipient: recipient.address },
            ]);

            const currentSenderBalance = await vault.getInternalBalance(sender.address, [tokens.DAI.address]);
            expect(currentSenderBalance[0]).to.be.equal(previousSenderBalance[0].sub(amount));

            const currentRecipientBalance = await vault.getInternalBalance(recipient.address, [tokens.DAI.address]);
            expect(currentRecipientBalance[0]).to.be.equal(previousRecipientBalance[0]);
          });

          it('emits an event', async () => {
            const receipt = await (
              await vault.withdrawFromInternalBalance([
                { token: tokens.DAI.address, amount: amount, sender: sender.address, recipient: recipient.address },
              ])
            ).wait();

            expectEvent.inReceipt(receipt, 'InternalBalanceChanged', {
              user: sender.address,
              token: tokens.DAI.address,
              balance: initialBalance.sub(amount),
            });
          });
        });

        context('with protocol withdraw fees', () => {
          context('when there was no deposit in the same block', () => {
            it('transfers the requested amount minus the expected fee', async () => {
              await expectBalanceChange(
                () =>
                  vault.withdrawFromInternalBalance([
                    { token: tokens.DAI.address, amount: amount, sender: sender.address, recipient: recipient.address },
                  ]),
                tokens,
                { account: recipient, changes: { DAI: amount.sub(pct(amount, WITHDRAW_FEE)) } }
              );
            });

            it('protocol fees are collected', async () => {
              const previousCollectedFees = await vault.getCollectedFees([tokens.DAI.address]);

              await vault.withdrawFromInternalBalance([
                { token: tokens.DAI.address, amount: amount, sender: sender.address, recipient: recipient.address },
              ]);

              const currentCollectedFees = await vault.getCollectedFees([tokens.DAI.address]);
              expect(currentCollectedFees[0].sub(previousCollectedFees[0])).to.equal(pct(amount, WITHDRAW_FEE));
            });
          });

          context('when there were some deposits in the same block', () => {
            let relayer: Contract;

            sharedBeforeEach('deploy relayer', async () => {
              relayer = await deploy('MockInternalBalanceRelayer', { args: [vault.address] });
              const withdrawRole = roleId(vault, 'depositToInternalBalance');
              const depositRole = roleId(vault, 'withdrawFromInternalBalance');
              await authorizer.connect(admin).grantRoles([withdrawRole, depositRole], relayer.address);
              await vault.connect(sender).changeRelayerAllowance(relayer.address, true);
            });

            const itDoesNotChargeWithdrawFees = (naryDeposits: NAry<BigNumber>, naryWithdraws: NAry<BigNumber>) => {
              const deposits = Array.isArray(naryDeposits) ? naryDeposits : [naryDeposits];
              const withdraws = Array.isArray(naryWithdraws) ? naryWithdraws : [naryWithdraws];

              it('transfers the requested amount without fees', async () => {
                // amount to deposit is greater than or equal to the withdrawn amount
                const totalAmountToDeposit = deposits.reduce((total, amount) => total.add(amount), bn(0));
                const totalAmountToWithdraw = withdraws.reduce((total, amount) => total.add(amount), bn(0));
                const expectedBalanceChange = totalAmountToWithdraw.sub(totalAmountToDeposit);

                await expectBalanceChange(
                  () => relayer.depositAndWithdraw(sender.address, tokens.DAI.address, deposits, withdraws),
                  tokens,
                  { account: sender, changes: { DAI: expectedBalanceChange } }
                );
              });

              it('does not collect protocol fees', async () => {
                const previousCollectedFees = await vault.getCollectedFees([tokens.DAI.address]);

                await relayer.depositAndWithdraw(sender.address, tokens.DAI.address, deposits, withdraws);

                const currentCollectedFees = await vault.getCollectedFees([tokens.DAI.address]);
                expect(currentCollectedFees[0]).to.equal(previousCollectedFees[0]);
              });
            };

            context('when there was one deposit in the same block', () => {
              const amountToDeposit = fp(10);

              sharedBeforeEach('approve amounts to deposit', async () => {
                await tokens.DAI.mint(sender, amountToDeposit);
                await tokens.DAI.approve(vault, amountToDeposit, { from: sender });
              });

              context('when withdrawing less than the deposited amount', () => {
                const amountToWithdraw = amountToDeposit.div(2);

                itDoesNotChargeWithdrawFees(amountToDeposit, amountToWithdraw);
              });

              context('when withdrawing the same deposited amount', () => {
                const amountToWithdraw = amountToDeposit;

                itDoesNotChargeWithdrawFees(amountToDeposit, amountToWithdraw);
              });

              context('when withdrawing more than the deposited amount', () => {
                context('when the previous internal balance was enough', () => {
                  const amountToWithdraw = amountToDeposit.add(depositedAmount.div(2));
                  const expectedTaxableAmount = amountToWithdraw.sub(amountToDeposit);
                  const expectedWithdrawFees = pct(expectedTaxableAmount, WITHDRAW_FEE);

                  it('transfers the requested amount minus the expected fee', async () => {
                    const expectedWithdrawnAmount = expectedTaxableAmount.sub(expectedWithdrawFees);

                    await expectBalanceChange(
                      () =>
                        relayer.depositAndWithdraw(
                          sender.address,
                          tokens.DAI.address,
                          [amountToDeposit],
                          [amountToWithdraw]
                        ),
                      tokens,
                      { account: sender, changes: { DAI: expectedWithdrawnAmount } }
                    );
                  });

                  it('protocol fees are collected', async () => {
                    const previousCollectedFees = await vault.getCollectedFees([tokens.DAI.address]);

                    await relayer.depositAndWithdraw(
                      sender.address,
                      tokens.DAI.address,
                      [amountToDeposit],
                      [amountToWithdraw]
                    );

                    const currentCollectedFees = await vault.getCollectedFees([tokens.DAI.address]);
                    expect(currentCollectedFees[0].sub(previousCollectedFees[0])).to.equal(expectedWithdrawFees);
                  });
                });

                context('when the previous internal balance was not enough', () => {
                  const amountToWithdraw = amountToDeposit.add(depositedAmount).add(1);

                  it('reverts', async () => {
                    const tx = relayer.depositAndWithdraw(
                      sender.address,
                      tokens.DAI.address,
                      [amountToDeposit],
                      [amountToWithdraw]
                    );
                    await expect(tx).to.be.revertedWith('INSUFFICIENT_INTERNAL_BALANCE');
                  });
                });
              });
            });

            context('when there were many operations in the same block', () => {
              const amountsToDeposit = [fp(10), fp(20)];
              const totalAmountToDeposit = amountsToDeposit.reduce((total, amount) => total.add(amount), bn(0));

              sharedBeforeEach('approve amounts to deposit', async () => {
                await tokens.DAI.mint(sender, totalAmountToDeposit);
                await tokens.DAI.approve(vault, totalAmountToDeposit, { from: sender });
              });

              context('when withdrawing less than the deposited amount', () => {
                const amountsToWithdraw = amountsToDeposit.map((amount) => amount.div(2));

                itDoesNotChargeWithdrawFees(amountsToDeposit, amountsToWithdraw);
              });

              context('when withdrawing the same deposited amount', () => {
                const amountsToWithdraw = amountsToDeposit;

                itDoesNotChargeWithdrawFees(amountsToDeposit, amountsToWithdraw);
              });

              context('when withdrawing more than the deposited amount', () => {
                context('when the previous internal balance was enough', () => {
                  const amountsToWithdraw = amountsToDeposit.map((amount) => amount.add(depositedAmount.div(4)));
                  const totalAmountToWithdraw = amountsToWithdraw.reduce((total, amount) => total.add(amount), bn(0));
                  const expectedTaxableAmount = totalAmountToWithdraw.sub(totalAmountToDeposit);
                  const expectedWithdrawFees = pct(expectedTaxableAmount, WITHDRAW_FEE);

                  it('transfers the requested amount minus the expected fee', async () => {
                    const expectedWithdrawnAmount = expectedTaxableAmount.sub(expectedWithdrawFees);

                    await expectBalanceChange(
                      () =>
                        relayer.depositAndWithdraw(
                          sender.address,
                          tokens.DAI.address,
                          amountsToDeposit,
                          amountsToWithdraw
                        ),
                      tokens,
                      { account: sender, changes: { DAI: expectedWithdrawnAmount } }
                    );
                  });

                  it('protocol fees are collected', async () => {
                    const previousCollectedFees = await vault.getCollectedFees([tokens.DAI.address]);

                    await relayer.depositAndWithdraw(
                      sender.address,
                      tokens.DAI.address,
                      amountsToDeposit,
                      amountsToWithdraw
                    );

                    const currentCollectedFees = await vault.getCollectedFees([tokens.DAI.address]);
                    expect(currentCollectedFees[0].sub(previousCollectedFees[0])).to.equal(expectedWithdrawFees);
                  });
                });

                context('when the previous internal balance was not enough', () => {
                  const amountsToWithdraw = [totalAmountToDeposit.add(depositedAmount), 1];

                  it('reverts', async () => {
                    const tx = relayer.depositAndWithdraw(
                      sender.address,
                      tokens.DAI.address,
                      amountsToDeposit,
                      amountsToWithdraw
                    );
                    await expect(tx).to.be.revertedWith('INSUFFICIENT_INTERNAL_BALANCE');
                  });
                });
              });
            });
          });
        });
      });
    };

    context('when the sender is a user', () => {
      beforeEach('set sender', () => {
        vault = vault.connect(sender);
      });

      context('when the sender has enough internal balance', () => {
        sharedBeforeEach('deposit internal balance', async () => {
          await tokens.DAI.mint(sender, depositedAmount);
          await tokens.DAI.approve(vault, depositedAmount, { from: sender });
          await vault.depositToInternalBalance([
            {
              token: tokens.DAI.address,
              amount: depositedAmount,
              sender: sender.address,
              recipient: sender.address,
            },
          ]);
        });

        context('when requesting all the available balance', () => {
          const amount = depositedAmount;

          itHandlesWithdrawalsProperly(depositedAmount, amount);
        });

        context('when requesting part of the balance', () => {
          const amount = depositedAmount.div(2);

          itHandlesWithdrawalsProperly(depositedAmount, amount);
        });

        context('when requesting no balance', () => {
          const amount = bn(0);

          itHandlesWithdrawalsProperly(depositedAmount, amount);
        });

        context('with requesting more balance than available', () => {
          const amount = depositedAmount.add(1);

          it('reverts', async () => {
            await expect(
              vault.withdrawFromInternalBalance([
                { token: tokens.DAI.address, amount: amount, sender: sender.address, recipient: recipient.address },
              ])
            ).to.be.revertedWith('INSUFFICIENT_INTERNAL_BALANCE');
          });
        });
      });

      context('when the sender does not have any internal balance', () => {
        const amount = 1;

        it('reverts', async () => {
          await expect(
            vault.withdrawFromInternalBalance([
              { token: tokens.DAI.address, amount: amount, sender: sender.address, recipient: recipient.address },
            ])
          ).to.be.revertedWith('INSUFFICIENT_INTERNAL_BALANCE');
        });
      });
    });

    context('when the sender is a relayer', () => {
      beforeEach('set sender', () => {
        vault = vault.connect(relayer);
      });

      sharedBeforeEach('mint tokens and deposit to internal balance', async () => {
        await tokens.DAI.mint(sender, depositedAmount);
        await tokens.DAI.approve(vault, depositedAmount, { from: sender });
        await vault
          .connect(sender)
          .depositToInternalBalance([
            { token: tokens.DAI.address, amount: depositedAmount, sender: sender.address, recipient: sender.address },
          ]);
      });

      context('when the relayer is whitelisted by the authorizer', () => {
        sharedBeforeEach('grant role to relayer', async () => {
          const role = roleId(vault, 'withdrawFromInternalBalance');
          await authorizer.connect(admin).grantRole(role, relayer.address);
        });

        context('when the relayer is allowed by the user', () => {
          sharedBeforeEach('allow relayer', async () => {
            await vault.connect(sender).changeRelayerAllowance(relayer.address, true);
          });

          itHandlesWithdrawalsProperly(depositedAmount, depositedAmount);
        });

        context('when the relayer is not allowed by the user', () => {
          it('reverts', async () => {
            await expect(
              vault.withdrawFromInternalBalance([
                {
                  token: tokens.DAI.address,
                  amount: depositedAmount,
                  sender: sender.address,
                  recipient: recipient.address,
                },
              ])
            ).to.be.revertedWith('USER_DOESNT_ALLOW_RELAYER');
          });
        });
      });

      context('when the relayer is not whitelisted by the authorizer', () => {
        context('when the relayer is allowed by the user', () => {
          sharedBeforeEach('allow relayer', async () => {
            await vault.connect(sender).changeRelayerAllowance(relayer.address, true);
          });

          it('reverts', async () => {
            await expect(
              vault.withdrawFromInternalBalance([
                {
                  token: tokens.DAI.address,
                  amount: depositedAmount,
                  sender: sender.address,
                  recipient: recipient.address,
                },
              ])
            ).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });
        });

        context('when the relayer is not allowed by the user', () => {
          sharedBeforeEach('disallow relayer', async () => {
            await vault.connect(sender).changeRelayerAllowance(relayer.address, false);
          });

          it('reverts', async () => {
            await expect(
              vault.withdrawFromInternalBalance([
                {
                  token: tokens.DAI.address,
                  amount: depositedAmount,
                  sender: sender.address,
                  recipient: recipient.address,
                },
              ])
            ).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });
        });
      });
    });
  });

  describe('transfer', () => {
    function itHandlesTransfersProperly(
      initialBalances: Dictionary<BigNumber>,
      transferredAmounts: Dictionary<BigNumber>
    ) {
      const amounts = Object.values(transferredAmounts);

      it('transfers the tokens from the sender to a single recipient', async () => {
        const previousSenderBalances = await vault.getInternalBalance(sender.address, tokens.addresses);
        const previousRecipientBalances = await vault.getInternalBalance(recipient.address, tokens.addresses);

        await vault.transferInternalBalance(
          tokens.map((token, i) => ({
            token: token.address,
            amount: amounts[i],
            sender: sender.address,
            recipient: recipient.address,
          }))
        );

        const senderBalances = await vault.getInternalBalance(sender.address, tokens.addresses);
        const recipientBalances = await vault.getInternalBalance(recipient.address, tokens.addresses);

        for (let i = 0; i < tokens.addresses.length; i++) {
          expect(senderBalances[i]).to.equal(previousSenderBalances[i].sub(amounts[i]));
          expect(recipientBalances[i]).to.equal(previousRecipientBalances[i].add(amounts[i]));
        }
      });

      it('transfers the tokens from the sender to multiple recipients', async () => {
        const previousSenderBalances = await vault.getInternalBalance(sender.address, tokens.addresses);
        const previousRecipientBalances = await vault.getInternalBalance(recipient.address, tokens.addresses);
        const previousOtherRecipientBalances = await vault.getInternalBalance(otherRecipient.address, tokens.addresses);

        await vault.transferInternalBalance([
          {
            token: tokens.first.address,
            amount: amounts[0],
            sender: sender.address,
            recipient: recipient.address,
          },
          {
            token: tokens.second.address,
            amount: amounts[1],
            sender: sender.address,
            recipient: otherRecipient.address,
          },
        ]);

        const senderBalances = await vault.getInternalBalance(sender.address, tokens.addresses);
        const recipientBalances = await vault.getInternalBalance(recipient.address, tokens.addresses);
        const otherRecipientBalances = await vault.getInternalBalance(otherRecipient.address, tokens.addresses);

        for (let i = 0; i < tokens.addresses.length; i++) {
          expect(senderBalances[i]).to.equal(previousSenderBalances[i].sub(amounts[i]));
        }

        expect(recipientBalances[0]).to.equal(previousRecipientBalances[0].add(amounts[0]));
        expect(recipientBalances[1]).to.equal(previousRecipientBalances[1]);

        expect(otherRecipientBalances[0]).to.equal(previousOtherRecipientBalances[0]);
        expect(otherRecipientBalances[1]).to.equal(previousOtherRecipientBalances[1].add(amounts[1]));
      });

      it('does not affect the token balances of the sender nor the recipient', async () => {
        const previousBalances: Dictionary<Dictionary<BigNumber>> = {};

        await tokens.asyncEach(async (token: Token) => {
          const senderBalance = await token.balanceOf(sender.address);
          const recipientBalance = await token.balanceOf(recipient.address);
          previousBalances[token.symbol] = { sender: senderBalance, recipient: recipientBalance };
        });

        await vault.transferInternalBalance(
          tokens.map((token, i) => ({
            token: token.address,
            amount: amounts[i],
            sender: sender.address,
            recipient: recipient.address,
          }))
        );

        await tokens.asyncEach(async (token: Token) => {
          const senderBalance = await token.balanceOf(sender.address);
          expect(senderBalance).to.equal(previousBalances[token.symbol].sender);

          const recipientBalance = await token.balanceOf(recipient.address);
          expect(recipientBalance).to.equal(previousBalances[token.symbol].recipient);
        });
      });

      it('emits an event for each transfer', async () => {
        const receipt = await (
          await vault.transferInternalBalance(
            tokens.map((token, i) => ({
              token: token.address,
              amount: amounts[i],
              sender: sender.address,
              recipient: recipient.address,
            }))
          )
        ).wait();

        expectEvent.inReceipt(receipt, 'InternalBalanceChanged', {
          user: sender.address,
          token: tokens.DAI.address,
          balance: initialBalances.DAI.sub(transferredAmounts.DAI),
        });

        expectEvent.inReceipt(receipt, 'InternalBalanceChanged', {
          user: sender.address,
          token: tokens.MKR.address,
          balance: initialBalances.MKR.sub(transferredAmounts.MKR),
        });

        expectEvent.inReceipt(receipt, 'InternalBalanceChanged', {
          user: recipient.address,
          token: tokens.DAI.address,
          balance: transferredAmounts.DAI,
        });

        expectEvent.inReceipt(receipt, 'InternalBalanceChanged', {
          user: recipient.address,
          token: tokens.MKR.address,
          balance: transferredAmounts.MKR,
        });
      });
    }

    function depositInitialBalances(initialBalances: Dictionary<BigNumber>) {
      sharedBeforeEach('deposit initial balances', async () => {
        const balances = await tokens.asyncMap(async (token: Token) => {
          const amount = initialBalances[token.symbol];
          await token.mint(sender, amount);
          await token.approve(vault, amount, { from: sender });
          return amount;
        });

        await vault.connect(sender).depositToInternalBalance(
          tokens.map((token, i) => ({
            token: token.address,
            amount: balances[i],
            sender: sender.address,
            recipient: sender.address,
          }))
        );
      });
    }

    context('when the sender is a user', () => {
      beforeEach('set sender', () => {
        vault = vault.connect(sender);
      });

      function itReverts(transferredAmounts: Dictionary<BigNumber>, errorReason = 'INSUFFICIENT_INTERNAL_BALANCE') {
        it('reverts', async () => {
          const amounts = Object.values(transferredAmounts);
          await expect(
            vault.transferInternalBalance(
              tokens.map((token, i) => ({
                token: token.address,
                amount: amounts[i],
                sender: sender.address,
                recipient: recipient.address,
              }))
            )
          ).to.be.revertedWith(errorReason);
        });
      }

      context('when the sender specifies some balance', () => {
        const transferredAmounts = { DAI: bn(1e16), MKR: bn(2e16) };

        context('when the sender holds enough balance', () => {
          const initialBalances = { DAI: bn(1e18), MKR: bn(5e19) };

          depositInitialBalances(initialBalances);
          itHandlesTransfersProperly(initialBalances, transferredAmounts);
        });

        context('when the sender does not hold said balance', () => {
          context('when the sender does not hold enough balance of one token', () => {
            depositInitialBalances({ DAI: bn(10), MKR: bn(5e19) });

            itReverts(transferredAmounts);
          });

          context('when the sender does not hold enough balance of the other token', () => {
            depositInitialBalances({ DAI: bn(1e18), MKR: bn(5) });

            itReverts(transferredAmounts);
          });

          context('when the sender does not hold enough balance of both tokens', () => {
            depositInitialBalances({ DAI: bn(10), MKR: bn(5) });

            itReverts(transferredAmounts);
          });
        });
      });

      context('when the sender does not specify any balance', () => {
        const transferredAmounts = { DAI: bn(0), MKR: bn(0) };

        context('when the sender holds some balance', () => {
          const initialBalances: Dictionary<BigNumber> = { DAI: bn(1e18), MKR: bn(5e19) };

          depositInitialBalances(initialBalances);
          itHandlesTransfersProperly(initialBalances, transferredAmounts);
        });

        context('when the sender does not have any balance', () => {
          const initialBalances = { DAI: bn(0), MKR: bn(0) };

          itHandlesTransfersProperly(initialBalances, transferredAmounts);
        });
      });
    });

    context('when the sender is a relayer', () => {
      const transferredAmounts = { DAI: bn(1e16), MKR: bn(2e16) };
      const amounts = Object.values(transferredAmounts);

      beforeEach('set sender', () => {
        vault = vault.connect(relayer);
      });

      depositInitialBalances(transferredAmounts);

      context('when the relayer is whitelisted by the authorizer', () => {
        sharedBeforeEach('grant role to relayer', async () => {
          const role = roleId(vault, 'transferInternalBalance');
          await authorizer.connect(admin).grantRole(role, relayer.address);
        });

        context('when the relayer is allowed by the user', () => {
          sharedBeforeEach('allow relayer', async () => {
            await vault.connect(sender).changeRelayerAllowance(relayer.address, true);
          });

          itHandlesTransfersProperly(transferredAmounts, transferredAmounts);
        });

        context('when the relayer is not allowed by the user', () => {
          it('reverts', async () => {
            await expect(
              vault.transferInternalBalance(
                tokens.map((token, i) => ({
                  token: token.address,
                  amount: amounts[i],
                  sender: sender.address,
                  recipient: recipient.address,
                }))
              )
            ).to.be.revertedWith('USER_DOESNT_ALLOW_RELAYER');
          });
        });
      });

      context('when the relayer is not whitelisted by the authorizer', () => {
        context('when the relayer is allowed by the user', () => {
          sharedBeforeEach('allow relayer', async () => {
            await vault.connect(sender).changeRelayerAllowance(relayer.address, true);
          });

          it('reverts', async () => {
            await expect(
              vault.transferInternalBalance(
                tokens.map((token, i) => ({
                  token: token.address,
                  amount: amounts[i],
                  sender: sender.address,
                  recipient: recipient.address,
                }))
              )
            ).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });
        });

        context('when the relayer is not allowed by the user', () => {
          sharedBeforeEach('disallow relayer', async () => {
            await vault.connect(sender).changeRelayerAllowance(relayer.address, false);
          });

          it('reverts', async () => {
            await expect(
              vault.transferInternalBalance(
                tokens.map((token, i) => ({
                  token: token.address,
                  amount: amounts[i],
                  sender: sender.address,
                  recipient: recipient.address,
                }))
              )
            ).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });
        });
      });
    });
  });

  describe('external transfer', () => {
    const balance = bn(10);

    const itHandlesExternalTransfersProperly = (amount: BigNumber) => {
      it('transfers the tokens from the sender to the recipient, using the vault allowance of the sender', async () => {
        await expectBalanceChange(
          () =>
            vault.transferToExternalBalance([
              { token: tokens.DAI.address, amount: amount, sender: sender.address, recipient: recipient.address },
            ]),
          tokens,
          [
            { account: sender.address, changes: { DAI: -amount } },
            { account: vault.address, changes: { DAI: 0 } },
            { account: recipient.address, changes: { DAI: amount } },
          ]
        );
      });

      it('does not change the internal balances of the accounts', async () => {
        const previousSenderBalance = await vault.getInternalBalance(sender.address, [tokens.DAI.address]);
        const previousRecipientBalance = await vault.getInternalBalance(recipient.address, [tokens.DAI.address]);

        await vault.transferToExternalBalance([
          { token: tokens.DAI.address, amount: amount, sender: sender.address, recipient: recipient.address },
        ]);

        const currentSenderBalance = await vault.getInternalBalance(sender.address, [tokens.DAI.address]);
        expect(currentSenderBalance[0]).to.be.equal(previousSenderBalance[0]);

        const currentRecipientBalance = await vault.getInternalBalance(recipient.address, [tokens.DAI.address]);
        expect(currentRecipientBalance[0]).to.be.equal(previousRecipientBalance[0]);
      });

      it('does not emit an event', async () => {
        const receipt = await (
          await vault.transferToExternalBalance([
            { token: tokens.DAI.address, amount: amount, sender: sender.address, recipient: recipient.address },
          ])
        ).wait();

        expectEvent.notEmitted(receipt, 'InternalBalanceChanged');
      });
    };

    context('when the sender is the user', () => {
      beforeEach('set sender', () => {
        vault = vault.connect(sender);
      });

      context('when the token is not the zero address', () => {
        context('when the sender does hold enough balance', () => {
          sharedBeforeEach('mint tokens', async () => {
            await tokens.DAI.mint(sender, balance);
          });

          context('when the given amount is approved by the sender', () => {
            sharedBeforeEach('approve tokens', async () => {
              await tokens.DAI.approve(vault.address, balance, { from: sender });
            });

            context('when tokens and balances match', () => {
              context('when depositing zero balance', () => {
                const transferAmount = bn(0);

                itHandlesExternalTransfersProperly(transferAmount);
              });

              context('when depositing some balance', () => {
                const transferAmount = balance;

                itHandlesExternalTransfersProperly(transferAmount);
              });
            });
          });

          context('when the given amount is not approved by the sender', () => {
            it('reverts', async () => {
              await expect(
                vault.transferToExternalBalance([
                  {
                    token: tokens.DAI.address,
                    amount: balance,
                    sender: sender.address,
                    recipient: recipient.address,
                  },
                ])
              ).to.be.revertedWith('ERC20: transfer amount exceeds allowance');
            });
          });
        });

        context('when the sender does not hold enough balance', () => {
          it('reverts', async () => {
            await expect(
              vault.transferToExternalBalance([
                {
                  token: tokens.DAI.address,
                  amount: balance,
                  sender: sender.address,
                  recipient: recipient.address,
                },
              ])
            ).to.be.revertedWith('ERC20: transfer amount exceeds balance');
          });
        });
      });

      context('when the token is the zero address', () => {
        it('reverts', async () => {
          await expect(
            vault.transferToExternalBalance([
              { token: ZERO_ADDRESS, amount: balance, sender: sender.address, recipient: recipient.address },
            ])
          ).to.be.revertedWith('Address: call to non-contract');
        });
      });
    });

    context('when the sender is a relayer', () => {
      beforeEach('set sender', () => {
        vault = vault.connect(relayer);
      });

      sharedBeforeEach('mint tokens for sender', async () => {
        await tokens.DAI.mint(sender, balance);
        await tokens.DAI.approve(vault, balance, { from: sender });
      });

      context('when the relayer is whitelisted by the authorizer', () => {
        sharedBeforeEach('grant role to relayer', async () => {
          const role = roleId(vault, 'transferToExternalBalance');
          await authorizer.connect(admin).grantRole(role, relayer.address);
        });

        context('when the relayer is allowed to transfer by the user', () => {
          sharedBeforeEach('allow relayer', async () => {
            await vault.connect(sender).changeRelayerAllowance(relayer.address, true);
          });

          itHandlesExternalTransfersProperly(balance);
        });

        context('when the relayer is not allowed by the user', () => {
          it('reverts', async () => {
            await expect(
              vault.transferToExternalBalance([
                {
                  token: tokens.DAI.address,
                  amount: balance,
                  sender: sender.address,
                  recipient: recipient.address,
                },
              ])
            ).to.be.revertedWith('USER_DOESNT_ALLOW_RELAYER');
          });
        });
      });

      context('when the relayer is not whitelisted by the authorizer', () => {
        context('when the relayer is allowed by the user', () => {
          sharedBeforeEach('allow relayer', async () => {
            await vault.connect(sender).changeRelayerAllowance(relayer.address, true);
          });

          it('reverts', async () => {
            await expect(
              vault.transferToExternalBalance([
                {
                  token: tokens.DAI.address,
                  amount: balance,
                  sender: sender.address,
                  recipient: recipient.address,
                },
              ])
            ).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });
        });

        context('when the relayer is not allowed by the user', () => {
          sharedBeforeEach('disallow relayer', async () => {
            await vault.connect(sender).changeRelayerAllowance(relayer.address, false);
          });

          it('reverts', async () => {
            await expect(
              vault.transferToExternalBalance([
                {
                  token: tokens.DAI.address,
                  amount: balance,
                  sender: sender.address,
                  recipient: recipient.address,
                },
              ])
            ).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });
        });
      });
    });
  });
});
