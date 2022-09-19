import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Dictionary } from 'lodash';
import { BigNumber, Contract, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokensDeployer from '@balancer-labs/v2-helpers/src/models/tokens/TokensDeployer';
import TokenList, { ETH_TOKEN_ADDRESS } from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import { bn } from '@balancer-labs/v2-helpers/src/numbers';
import { MONTH } from '@balancer-labs/v2-helpers/src/time';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { forceSendEth } from './helpers/eth';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import { ANY_ADDRESS, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

const OP_KIND = {
  DEPOSIT_INTERNAL: 0,
  WITHDRAW_INTERNAL: 1,
  TRANSFER_INTERNAL: 2,
  TRANSFER_EXTERNAL: 3,
};

describe('Internal Balance', () => {
  let admin: SignerWithAddress, sender: SignerWithAddress, recipient: SignerWithAddress;
  let relayer: SignerWithAddress, otherRecipient: SignerWithAddress;
  let authorizer: Contract, vault: Contract;
  let tokens: TokenList, weth: Token;

  before('setup signers', async () => {
    [, admin, sender, recipient, otherRecipient, relayer] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault & tokens', async () => {
    tokens = await TokenList.create(['DAI', 'MKR'], { sorted: true });
    weth = await TokensDeployer.deployToken({ symbol: 'WETH' });

    authorizer = await deploy('TimelockAuthorizer', { args: [admin.address, ZERO_ADDRESS, MONTH] });
    vault = await deploy('Vault', { args: [authorizer.address, weth.address, MONTH, MONTH] });
  });

  describe('deposit internal balance', () => {
    const kind = OP_KIND.DEPOSIT_INTERNAL;
    const initialBalance = bn(10);

    const itHandlesDepositsProperly = (amount: BigNumber, relayed = false) => {
      it('transfers the tokens from the sender to the vault', async () => {
        await expectBalanceChange(
          () =>
            vault.manageUserBalance([
              { kind, asset: tokens.DAI.address, amount: amount, sender: sender.address, recipient: recipient.address },
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

        await vault.manageUserBalance([
          { kind, asset: tokens.DAI.address, amount: amount, sender: sender.address, recipient: recipient.address },
        ]);

        const currentSenderBalance = await vault.getInternalBalance(sender.address, [tokens.DAI.address]);
        expect(currentSenderBalance[0]).to.be.equal(previousSenderBalance[0]);

        const currentRecipientBalance = await vault.getInternalBalance(recipient.address, [tokens.DAI.address]);
        expect(currentRecipientBalance[0]).to.be.equal(previousRecipientBalance[0].add(amount));
      });

      it('returns ETH if any is sent', async () => {
        const senderAddress = relayed ? relayer.address : sender.address;
        const previousBalance = await ethers.provider.getBalance(senderAddress);

        const gasPrice = await ethers.provider.getGasPrice();
        const receipt: ContractReceipt = await (
          await vault.manageUserBalance(
            [{ kind, asset: tokens.DAI.address, amount: amount, sender: sender.address, recipient: recipient.address }],
            { value: 100, gasPrice }
          )
        ).wait();

        const ethSpent = receipt.gasUsed.mul(gasPrice);

        const currentBalance = await ethers.provider.getBalance(senderAddress);
        expect(previousBalance.sub(currentBalance)).to.equal(ethSpent);
      });

      it('emits an event', async () => {
        const receipt = await (
          await vault.manageUserBalance([
            { kind, asset: tokens.DAI.address, amount: amount, sender: sender.address, recipient: recipient.address },
          ])
        ).wait();

        expectEvent.inReceipt(receipt, 'InternalBalanceChanged', {
          user: recipient.address,
          token: tokens.DAI.address,
          delta: amount,
        });
      });
    };

    context('when the sender is the user', () => {
      beforeEach('set sender', () => {
        vault = vault.connect(sender);
      });

      context('when the asset is a token', () => {
        context('when the sender does hold enough balance', () => {
          sharedBeforeEach('mint tokens', async () => {
            await tokens.DAI.mint(sender, initialBalance);
          });

          context('when the given amount is approved by the sender', () => {
            sharedBeforeEach('approve tokens', async () => {
              await tokens.DAI.approve(vault, initialBalance, { from: sender });
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
                vault.manageUserBalance([
                  {
                    kind,
                    asset: tokens.DAI.address,
                    amount: initialBalance,
                    sender: sender.address,
                    recipient: recipient.address,
                  },
                ])
              ).to.be.revertedWith('ERC20_TRANSFER_EXCEEDS_ALLOWANCE');
            });
          });
        });

        context('when the sender does not hold enough balance', () => {
          it('reverts', async () => {
            await expect(
              vault.manageUserBalance([
                {
                  kind,
                  asset: tokens.DAI.address,
                  amount: initialBalance,
                  sender: sender.address,
                  recipient: recipient.address,
                },
              ])
            ).to.be.revertedWith('ERC20_TRANSFER_EXCEEDS_BALANCE');
          });
        });
      });

      context('when the asset is ETH', () => {
        const amount = bn(100e18);

        sharedBeforeEach('mint tokens', async () => {
          await weth.mint(sender.address, amount);
          await weth.approve(vault, amount, { from: sender });
        });

        it('does not take WETH from the sender', async () => {
          await expectBalanceChange(
            () =>
              vault.manageUserBalance(
                [{ kind, asset: ETH_TOKEN_ADDRESS, amount, sender: sender.address, recipient: recipient.address }],
                { value: amount }
              ),
            tokens,
            { account: sender }
          );
        });

        it('increases the WETH internal balance for the recipient', async () => {
          const previousRecipientBalance = await vault.getInternalBalance(recipient.address, [weth.address]);

          await vault.manageUserBalance(
            [{ kind, asset: ETH_TOKEN_ADDRESS, amount, sender: sender.address, recipient: recipient.address }],
            { value: amount }
          );

          const currentRecipientBalance = await vault.getInternalBalance(recipient.address, [weth.address]);

          expect(currentRecipientBalance[0].sub(previousRecipientBalance[0])).to.equal(amount);
        });

        it('emits an event with WETH as the token address', async () => {
          const receipt: ContractReceipt = await (
            await vault.manageUserBalance(
              [{ kind, asset: ETH_TOKEN_ADDRESS, amount, sender: sender.address, recipient: recipient.address }],
              { value: amount }
            )
          ).wait();

          expectEvent.inReceipt(receipt, 'InternalBalanceChanged', {
            user: recipient.address,
            token: weth.address,
            delta: amount,
          });
        });

        it('accepts deposits of both ETH and WETH', async () => {
          const previousRecipientBalance = await vault.getInternalBalance(recipient.address, [weth.address]);

          await vault.manageUserBalance(
            [
              { kind, asset: ETH_TOKEN_ADDRESS, amount, sender: sender.address, recipient: recipient.address },
              { kind, asset: weth.address, amount, sender: sender.address, recipient: recipient.address },
            ],
            { value: amount }
          );

          const currentRecipientBalance = await vault.getInternalBalance(recipient.address, [weth.address]);

          expect(currentRecipientBalance[0].sub(previousRecipientBalance[0])).to.equal(amount.mul(2));
        });

        it('accepts multiple ETH deposits', async () => {
          const previousRecipientBalance = await vault.getInternalBalance(recipient.address, [weth.address]);

          await vault.manageUserBalance(
            [
              {
                kind,
                asset: ETH_TOKEN_ADDRESS,
                amount: amount.div(2),
                sender: sender.address,
                recipient: recipient.address,
              },
              {
                kind,
                asset: ETH_TOKEN_ADDRESS,
                amount: amount.div(2),
                sender: sender.address,
                recipient: recipient.address,
              },
            ],
            { value: amount }
          );

          const currentRecipientBalance = await vault.getInternalBalance(recipient.address, [weth.address]);

          expect(currentRecipientBalance[0].sub(previousRecipientBalance[0])).to.equal(amount);
        });

        it('reverts if not enough ETH was supplied', async () => {
          // Send ETH to the Vault to make sure that the test fails because of the supplied ETH, even if the Vault holds
          // enough to mint the WETH using its own.
          await forceSendEth(vault, amount);

          await expect(
            vault.manageUserBalance(
              [
                {
                  kind,
                  asset: ETH_TOKEN_ADDRESS,
                  amount: amount.div(2),
                  sender: sender.address,
                  recipient: recipient.address,
                },
                {
                  kind,
                  asset: ETH_TOKEN_ADDRESS,
                  amount: amount.div(2),
                  sender: sender.address,
                  recipient: recipient.address,
                },
              ],
              { value: amount.sub(1) }
            )
          ).to.be.revertedWith('INSUFFICIENT_ETH');
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
        sharedBeforeEach('grant permission to relayer', async () => {
          const action = await actionId(vault, 'manageUserBalance');
          await authorizer.connect(admin).grantPermissions([action], relayer.address, [ANY_ADDRESS]);
        });

        context('when the relayer is allowed to deposit by the user', () => {
          sharedBeforeEach('allow relayer', async () => {
            await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
          });

          itHandlesDepositsProperly(initialBalance, true);

          context('when the asset is ETH', () => {
            it('returns excess ETH to the relayer', async () => {
              const amount = bn(100e18);

              const relayerBalanceBefore = await ethers.provider.getBalance(relayer.address);

              const gasPrice = await ethers.provider.getGasPrice();
              const receipt: ContractReceipt = await (
                await vault.manageUserBalance(
                  [
                    {
                      kind,
                      asset: ETH_TOKEN_ADDRESS,
                      amount: amount.sub(42),
                      sender: sender.address,
                      recipient: recipient.address,
                    },
                  ],
                  { value: amount, gasPrice }
                )
              ).wait();
              const txETH = receipt.gasUsed.mul(gasPrice);

              const relayerBalanceAfter = await ethers.provider.getBalance(relayer.address);

              const ethSpent = txETH.add(amount).sub(42);
              expect(relayerBalanceBefore.sub(relayerBalanceAfter)).to.equal(ethSpent);
            });
          });
        });

        context('when the relayer is not allowed by the user', () => {
          it('reverts', async () => {
            await expect(
              vault.manageUserBalance([
                {
                  kind,
                  asset: tokens.DAI.address,
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
            await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
          });

          it('reverts', async () => {
            await expect(
              vault.manageUserBalance([
                {
                  kind,
                  asset: tokens.DAI.address,
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
            await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, false);
          });

          it('reverts', async () => {
            await expect(
              vault.manageUserBalance([
                {
                  kind,
                  asset: tokens.DAI.address,
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

  describe('withdraw internal balance', () => {
    const kind = OP_KIND.WITHDRAW_INTERNAL;

    const itHandlesWithdrawalsProperly = (depositedAmount: BigNumber, amount: BigNumber) => {
      context('when tokens and balances match', () => {
        it('transfers the tokens from the vault to recipient', async () => {
          await expectBalanceChange(
            () =>
              vault.manageUserBalance([
                {
                  kind,
                  asset: tokens.DAI.address,
                  amount: amount,
                  sender: sender.address,
                  recipient: recipient.address,
                },
              ]),
            tokens,
            { account: recipient, changes: { DAI: amount } }
          );
        });

        it('withdraws the internal balance from the sender account', async () => {
          const previousSenderBalance = await vault.getInternalBalance(sender.address, [tokens.DAI.address]);
          const previousRecipientBalance = await vault.getInternalBalance(recipient.address, [tokens.DAI.address]);

          await vault.manageUserBalance([
            { kind, asset: tokens.DAI.address, amount: amount, sender: sender.address, recipient: recipient.address },
          ]);

          const currentSenderBalance = await vault.getInternalBalance(sender.address, [tokens.DAI.address]);
          expect(currentSenderBalance[0]).to.be.equal(previousSenderBalance[0].sub(amount));

          const currentRecipientBalance = await vault.getInternalBalance(recipient.address, [tokens.DAI.address]);
          expect(currentRecipientBalance[0]).to.be.equal(previousRecipientBalance[0]);
        });

        it('emits an event', async () => {
          const receipt = await (
            await vault.manageUserBalance([
              { kind, asset: tokens.DAI.address, amount: amount, sender: sender.address, recipient: recipient.address },
            ])
          ).wait();

          expectEvent.inReceipt(receipt, 'InternalBalanceChanged', {
            user: sender.address,
            token: tokens.DAI.address,
            delta: amount.mul(-1),
          });
        });
      });
    };

    context('when the sender is a user', () => {
      beforeEach('set sender', () => {
        vault = vault.connect(sender);
      });

      context('when the asset is a token', () => {
        context('when the sender has enough internal balance', () => {
          const depositedAmount = bn(10e18);

          sharedBeforeEach('deposit internal balance', async () => {
            await tokens.DAI.mint(sender, depositedAmount);
            await tokens.DAI.approve(vault, depositedAmount, { from: sender });
            await vault.manageUserBalance([
              {
                kind: OP_KIND.DEPOSIT_INTERNAL,
                asset: tokens.DAI.address,
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
                vault.manageUserBalance([
                  {
                    kind,
                    asset: tokens.DAI.address,
                    amount: amount,
                    sender: sender.address,
                    recipient: recipient.address,
                  },
                ])
              ).to.be.revertedWith('INSUFFICIENT_INTERNAL_BALANCE');
            });
          });
        });

        context('when the sender does not have any internal balance', () => {
          const amount = 1;

          it('reverts', async () => {
            await expect(
              vault.manageUserBalance([
                {
                  kind,
                  asset: tokens.DAI.address,
                  amount: amount,
                  sender: sender.address,
                  recipient: recipient.address,
                },
              ])
            ).to.be.revertedWith('INSUFFICIENT_INTERNAL_BALANCE');
          });
        });
      });

      context('when the asset is ETH', () => {
        const amount = bn(100e18);

        context('when the sender has enough internal balance', () => {
          sharedBeforeEach('deposit internal balance', async () => {
            await weth.mint(sender, amount, { from: sender });
            await weth.approve(vault, amount, { from: sender });
            await vault.manageUserBalance([
              {
                kind: OP_KIND.DEPOSIT_INTERNAL,
                asset: weth.address,
                amount: amount,
                sender: sender.address,
                recipient: sender.address,
              },
            ]);
          });

          it('does not send WETH to the recipient', async () => {
            await expectBalanceChange(
              () =>
                vault.manageUserBalance([
                  { kind, asset: ETH_TOKEN_ADDRESS, amount, sender: sender.address, recipient: recipient.address },
                ]),
              tokens,
              { account: recipient }
            );
          });

          it('decreases the WETH internal balance for the sender', async () => {
            const previousSenderBalance = await vault.getInternalBalance(sender.address, [weth.address]);

            await vault.manageUserBalance([
              { kind, asset: ETH_TOKEN_ADDRESS, amount, sender: sender.address, recipient: recipient.address },
            ]);

            const currentSenderBalance = await vault.getInternalBalance(sender.address, [weth.address]);

            expect(previousSenderBalance[0].sub(currentSenderBalance[0])).to.equal(amount);
          });

          it('emits an event with WETH as the token address', async () => {
            const receipt: ContractReceipt = await (
              await vault.manageUserBalance([
                { kind, asset: ETH_TOKEN_ADDRESS, amount, sender: sender.address, recipient: recipient.address },
              ])
            ).wait();

            expectEvent.inReceipt(receipt, 'InternalBalanceChanged', {
              user: sender.address,
              token: weth.address,
              delta: amount.mul(-1),
            });
          });

          it('accepts withdrawals of both ETH and WETH', async () => {
            const previousSenderBalance = await vault.getInternalBalance(sender.address, [weth.address]);

            await vault.manageUserBalance([
              {
                kind,
                asset: ETH_TOKEN_ADDRESS,
                amount: amount.div(2),
                sender: sender.address,
                recipient: recipient.address,
              },
              {
                kind,
                asset: weth.address,
                amount: amount.div(2),
                sender: sender.address,
                recipient: recipient.address,
              },
            ]);

            const currentSenderBalance = await vault.getInternalBalance(sender.address, [weth.address]);

            expect(previousSenderBalance[0].sub(currentSenderBalance[0])).to.equal(amount);
          });
        });
      });
    });

    context('when the sender is a relayer', () => {
      const depositedAmount = bn(10e18);

      beforeEach('set sender', () => {
        vault = vault.connect(relayer);
      });

      sharedBeforeEach('mint tokens and deposit to internal balance', async () => {
        await tokens.DAI.mint(sender, depositedAmount);
        await tokens.DAI.approve(vault, depositedAmount, { from: sender });
        await vault.connect(sender).manageUserBalance([
          {
            kind: OP_KIND.DEPOSIT_INTERNAL,
            asset: tokens.DAI.address,
            amount: depositedAmount,
            sender: sender.address,
            recipient: sender.address,
          },
        ]);
      });

      context('when the relayer is whitelisted by the authorizer', () => {
        sharedBeforeEach('grant permission to relayer', async () => {
          const action = await actionId(vault, 'manageUserBalance');
          await authorizer.connect(admin).grantPermissions([action], relayer.address, [ANY_ADDRESS]);
        });

        context('when the relayer is allowed by the user', () => {
          sharedBeforeEach('allow relayer', async () => {
            await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
          });

          itHandlesWithdrawalsProperly(depositedAmount, depositedAmount);
        });

        context('when the relayer is not allowed by the user', () => {
          it('reverts', async () => {
            await expect(
              vault.manageUserBalance([
                {
                  kind,
                  asset: tokens.DAI.address,
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
            await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
          });

          it('reverts', async () => {
            await expect(
              vault.manageUserBalance([
                {
                  kind,
                  asset: tokens.DAI.address,
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
            await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, false);
          });

          it('reverts', async () => {
            await expect(
              vault.manageUserBalance([
                {
                  kind,
                  asset: tokens.DAI.address,
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

  describe('transfer internal balance', () => {
    const kind = OP_KIND.TRANSFER_INTERNAL;

    function itHandlesTransfersProperly(
      initialBalances: Dictionary<BigNumber>,
      transferredAmounts: Dictionary<BigNumber>
    ) {
      const amounts = Object.values(transferredAmounts);

      it('transfers the tokens from the sender to a single recipient', async () => {
        const previousSenderBalances = await vault.getInternalBalance(sender.address, tokens.addresses);
        const previousRecipientBalances = await vault.getInternalBalance(recipient.address, tokens.addresses);

        await vault.manageUserBalance(
          tokens.map((token, i) => ({
            kind,
            asset: token.address,
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

        await vault.manageUserBalance([
          {
            kind,
            asset: tokens.first.address,
            amount: amounts[0],
            sender: sender.address,
            recipient: recipient.address,
          },
          {
            kind,
            asset: tokens.second.address,
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

        await vault.manageUserBalance(
          tokens.map((token, i) => ({
            kind,
            asset: token.address,
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
          await vault.manageUserBalance(
            tokens.map((token, i) => ({
              kind,
              asset: token.address,
              amount: amounts[i],
              sender: sender.address,
              recipient: recipient.address,
            }))
          )
        ).wait();

        expectEvent.inReceipt(receipt, 'InternalBalanceChanged', {
          user: sender.address,
          token: tokens.DAI.address,
          delta: transferredAmounts.DAI.mul(-1),
        });

        expectEvent.inReceipt(receipt, 'InternalBalanceChanged', {
          user: sender.address,
          token: tokens.MKR.address,
          delta: transferredAmounts.MKR.mul(-1),
        });

        expectEvent.inReceipt(receipt, 'InternalBalanceChanged', {
          user: recipient.address,
          token: tokens.DAI.address,
          delta: transferredAmounts.DAI,
        });

        expectEvent.inReceipt(receipt, 'InternalBalanceChanged', {
          user: recipient.address,
          token: tokens.MKR.address,
          delta: transferredAmounts.MKR,
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

        await vault.connect(sender).manageUserBalance(
          tokens.map((token, i) => ({
            kind: OP_KIND.DEPOSIT_INTERNAL,
            asset: token.address,
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
            vault.manageUserBalance(
              tokens.map((token, i) => ({
                kind,
                asset: token.address,
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
        sharedBeforeEach('grant permission to relayer', async () => {
          const action = await actionId(vault, 'manageUserBalance');
          await authorizer.connect(admin).grantPermissions([action], relayer.address, [ANY_ADDRESS]);
        });

        context('when the relayer is allowed by the user', () => {
          sharedBeforeEach('allow relayer', async () => {
            await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
          });

          itHandlesTransfersProperly(transferredAmounts, transferredAmounts);
        });

        context('when the relayer is not allowed by the user', () => {
          it('reverts', async () => {
            await expect(
              vault.manageUserBalance(
                tokens.map((token, i) => ({
                  kind,
                  asset: token.address,
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
            await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
          });

          it('reverts', async () => {
            await expect(
              vault.manageUserBalance(
                tokens.map((token, i) => ({
                  kind,
                  asset: token.address,
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
            await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, false);
          });

          it('reverts', async () => {
            await expect(
              vault.manageUserBalance(
                tokens.map((token, i) => ({
                  kind,
                  asset: token.address,
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

  describe('transfer external balance', () => {
    const balance = bn(10);
    const kind = OP_KIND.TRANSFER_EXTERNAL;

    const itHandlesExternalTransfersProperly = (amount: BigNumber) => {
      it('transfers the tokens from the sender to the recipient, using the vault allowance of the sender', async () => {
        await expectBalanceChange(
          () =>
            vault.manageUserBalance([
              { kind, asset: tokens.DAI.address, amount: amount, sender: sender.address, recipient: recipient.address },
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

        await vault.manageUserBalance([
          { kind, asset: tokens.DAI.address, amount: amount, sender: sender.address, recipient: recipient.address },
        ]);

        const currentSenderBalance = await vault.getInternalBalance(sender.address, [tokens.DAI.address]);
        expect(currentSenderBalance[0]).to.be.equal(previousSenderBalance[0]);

        const currentRecipientBalance = await vault.getInternalBalance(recipient.address, [tokens.DAI.address]);
        expect(currentRecipientBalance[0]).to.be.equal(previousRecipientBalance[0]);
      });

      it(`${amount.gt(0) ? 'emits' : 'does not emit'} an event`, async () => {
        const receipt = await (
          await vault.manageUserBalance([
            { kind, asset: tokens.DAI.address, amount: amount, sender: sender.address, recipient: recipient.address },
          ])
        ).wait();

        expectEvent.notEmitted(receipt, 'InternalBalanceChanged');

        if (amount.gt(0)) {
          expectEvent.inReceipt(receipt, 'ExternalBalanceTransfer', {
            sender: sender.address,
            recipient: recipient.address,
            token: tokens.DAI.address,
            amount,
          });
        } else {
          expectEvent.notEmitted(receipt, 'ExternalBalanceTransfer');
        }
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
              await tokens.DAI.approve(vault, balance, { from: sender });
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
                vault.manageUserBalance([
                  {
                    kind,
                    asset: tokens.DAI.address,
                    amount: balance,
                    sender: sender.address,
                    recipient: recipient.address,
                  },
                ])
              ).to.be.revertedWith('ERC20_TRANSFER_EXCEEDS_ALLOWANCE');
            });
          });
        });

        context('when the sender does not hold enough balance', () => {
          it('reverts', async () => {
            await expect(
              vault.manageUserBalance([
                {
                  kind,
                  asset: tokens.DAI.address,
                  amount: balance,
                  sender: sender.address,
                  recipient: recipient.address,
                },
              ])
            ).to.be.revertedWith('ERC20_TRANSFER_EXCEEDS_BALANCE');
          });
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
        sharedBeforeEach('grant permission to relayer', async () => {
          const action = await actionId(vault, 'manageUserBalance');
          await authorizer.connect(admin).grantPermissions([action], relayer.address, [ANY_ADDRESS]);
        });

        context('when the relayer is allowed to transfer by the user', () => {
          sharedBeforeEach('allow relayer', async () => {
            await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
          });

          itHandlesExternalTransfersProperly(balance);
        });

        context('when the relayer is not allowed by the user', () => {
          it('reverts', async () => {
            await expect(
              vault.manageUserBalance([
                {
                  kind,
                  asset: tokens.DAI.address,
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
            await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
          });

          it('reverts', async () => {
            await expect(
              vault.manageUserBalance([
                {
                  kind,
                  asset: tokens.DAI.address,
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
            await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, false);
          });

          it('reverts', async () => {
            await expect(
              vault.manageUserBalance([
                {
                  kind,
                  asset: tokens.DAI.address,
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

  describe('batch', () => {
    type UserBalanceOp = {
      kind: number;
      amount: number;
      asset: string;
      sender: string;
      recipient: string;
    };

    const op = (
      kind: number,
      token: Token,
      amount: number,
      from: SignerWithAddress,
      to?: SignerWithAddress
    ): UserBalanceOp => {
      return { kind, asset: token.address, amount, sender: from.address, recipient: (to || from).address };
    };

    sharedBeforeEach('mint and approve tokens', async () => {
      await tokens.mint({ to: sender, amount: bn(1000e18) });
      await tokens.approve({ from: sender, to: vault });
    });

    sharedBeforeEach('allow relayer', async () => {
      const action = await actionId(vault, 'manageUserBalance');
      await authorizer.connect(admin).grantPermissions([action], relayer.address, [ANY_ADDRESS]);
      await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
      await vault.connect(recipient).setRelayerApproval(recipient.address, relayer.address, true);
    });

    context('when unpaused', () => {
      context('when all the senders allowed the relayer', () => {
        context('when all ops add up', () => {
          it('succeeds', async () => {
            const ops = [
              op(OP_KIND.DEPOSIT_INTERNAL, tokens.DAI, 10, sender, recipient),
              op(OP_KIND.DEPOSIT_INTERNAL, tokens.MKR, 20, sender, recipient),
              op(OP_KIND.WITHDRAW_INTERNAL, tokens.DAI, 5, recipient),
              op(OP_KIND.TRANSFER_INTERNAL, tokens.MKR, 8, recipient, otherRecipient),
              op(OP_KIND.TRANSFER_INTERNAL, tokens.MKR, 3, recipient, sender),
              op(OP_KIND.TRANSFER_EXTERNAL, tokens.MKR, 200, sender, otherRecipient),
              op(OP_KIND.DEPOSIT_INTERNAL, tokens.MKR, 100, sender, sender),
            ];

            await vault.connect(relayer).manageUserBalance(ops);

            expect((await vault.getInternalBalance(sender.address, [tokens.DAI.address]))[0]).to.equal(0);
            expect((await vault.getInternalBalance(sender.address, [tokens.MKR.address]))[0]).to.equal(103);

            expect((await vault.getInternalBalance(recipient.address, [tokens.DAI.address]))[0]).to.equal(5);
            expect((await vault.getInternalBalance(recipient.address, [tokens.MKR.address]))[0]).to.equal(9);

            expect((await vault.getInternalBalance(otherRecipient.address, [tokens.DAI.address]))[0]).to.equal(0);
            expect((await vault.getInternalBalance(otherRecipient.address, [tokens.MKR.address]))[0]).to.equal(8);

            expect(await tokens.MKR.balanceOf(otherRecipient)).to.be.equal(200);
          });
        });

        context('when all ops do not add up', () => {
          it('reverts', async () => {
            const ops = [
              op(OP_KIND.DEPOSIT_INTERNAL, tokens.DAI, 10, sender, recipient),
              op(OP_KIND.DEPOSIT_INTERNAL, tokens.MKR, 20, sender, recipient),
              op(OP_KIND.WITHDRAW_INTERNAL, tokens.DAI, 5, recipient),
              op(OP_KIND.TRANSFER_INTERNAL, tokens.MKR, 8, recipient, otherRecipient),
              op(OP_KIND.TRANSFER_INTERNAL, tokens.MKR, 3, recipient, sender),
              op(OP_KIND.TRANSFER_EXTERNAL, tokens.MKR, 200, sender, otherRecipient),
              op(OP_KIND.DEPOSIT_INTERNAL, tokens.MKR, 100, sender, sender),
              op(OP_KIND.WITHDRAW_INTERNAL, tokens.MKR, 10, recipient),
            ];

            await expect(vault.connect(relayer).manageUserBalance(ops)).to.be.revertedWith(
              'INSUFFICIENT_INTERNAL_BALANCE'
            );
          });
        });
      });

      context('when one of the senders did not allow the relayer', () => {
        it('reverts', async () => {
          const ops = [
            op(OP_KIND.DEPOSIT_INTERNAL, tokens.DAI, 10, sender, recipient),
            op(OP_KIND.DEPOSIT_INTERNAL, tokens.MKR, 20, sender, recipient),
            op(OP_KIND.WITHDRAW_INTERNAL, tokens.DAI, 5, recipient),
            op(OP_KIND.TRANSFER_INTERNAL, tokens.MKR, 8, recipient, otherRecipient),
            op(OP_KIND.TRANSFER_INTERNAL, tokens.MKR, 3, recipient, sender),
            op(OP_KIND.TRANSFER_EXTERNAL, tokens.MKR, 200, sender, otherRecipient),
            op(OP_KIND.DEPOSIT_INTERNAL, tokens.MKR, 100, sender, sender),
            op(OP_KIND.WITHDRAW_INTERNAL, tokens.MKR, 1, otherRecipient),
          ];

          await expect(vault.connect(relayer).manageUserBalance(ops)).to.be.revertedWith('USER_DOESNT_ALLOW_RELAYER');
        });
      });
    });

    context('when paused', () => {
      sharedBeforeEach('deposit some internal balances', async () => {
        const ops = [
          op(OP_KIND.DEPOSIT_INTERNAL, tokens.MKR, 1, sender, sender),
          op(OP_KIND.DEPOSIT_INTERNAL, tokens.DAI, 10, sender, recipient),
          op(OP_KIND.DEPOSIT_INTERNAL, tokens.MKR, 20, sender, recipient),
          op(OP_KIND.DEPOSIT_INTERNAL, tokens.DAI, 50, sender, otherRecipient),
        ];

        await vault.connect(relayer).manageUserBalance(ops);

        await vault.connect(otherRecipient).setRelayerApproval(otherRecipient.address, relayer.address, true);
      });

      sharedBeforeEach('pause', async () => {
        const action = await actionId(vault, 'setPaused');
        await authorizer.connect(admin).grantPermissions([action], admin.address, [ANY_ADDRESS]);
        await vault.connect(admin).setPaused(true);
      });

      context('when only withdrawing internal balance', () => {
        it('succeeds', async () => {
          const ops = [
            op(OP_KIND.WITHDRAW_INTERNAL, tokens.DAI, 10, otherRecipient),
            op(OP_KIND.WITHDRAW_INTERNAL, tokens.MKR, 1, sender),
            op(OP_KIND.WITHDRAW_INTERNAL, tokens.DAI, 5, recipient),
            op(OP_KIND.WITHDRAW_INTERNAL, tokens.MKR, 8, recipient),
            op(OP_KIND.WITHDRAW_INTERNAL, tokens.MKR, 3, recipient),
            op(OP_KIND.WITHDRAW_INTERNAL, tokens.DAI, 35, otherRecipient),
          ];

          await vault.connect(relayer).manageUserBalance(ops);

          expect((await vault.getInternalBalance(sender.address, [tokens.DAI.address]))[0]).to.equal(0);
          expect((await vault.getInternalBalance(sender.address, [tokens.MKR.address]))[0]).to.equal(0);

          expect((await vault.getInternalBalance(recipient.address, [tokens.DAI.address]))[0]).to.equal(5);
          expect((await vault.getInternalBalance(recipient.address, [tokens.MKR.address]))[0]).to.equal(9);

          expect((await vault.getInternalBalance(otherRecipient.address, [tokens.DAI.address]))[0]).to.equal(5);
          expect((await vault.getInternalBalance(otherRecipient.address, [tokens.MKR.address]))[0]).to.equal(0);
        });
      });

      context('when trying to perform multiple ops', () => {
        it('reverts', async () => {
          const ops = [
            op(OP_KIND.DEPOSIT_INTERNAL, tokens.DAI, 10, sender, recipient),
            op(OP_KIND.DEPOSIT_INTERNAL, tokens.MKR, 20, sender, recipient),
            op(OP_KIND.WITHDRAW_INTERNAL, tokens.DAI, 5, recipient, recipient),
            op(OP_KIND.TRANSFER_INTERNAL, tokens.MKR, 8, recipient, otherRecipient),
            op(OP_KIND.TRANSFER_INTERNAL, tokens.MKR, 3, recipient, sender),
            op(OP_KIND.TRANSFER_EXTERNAL, tokens.MKR, 200, sender, otherRecipient),
            op(OP_KIND.DEPOSIT_INTERNAL, tokens.MKR, 100, sender, sender),
            op(OP_KIND.WITHDRAW_INTERNAL, tokens.MKR, 1, otherRecipient, recipient),
          ];

          await expect(vault.connect(relayer).manageUserBalance(ops)).to.be.revertedWith('PAUSED');
        });
      });
    });
  });
});
