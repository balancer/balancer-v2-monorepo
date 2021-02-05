import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Dictionary } from 'lodash';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '../helpers/expectEvent';
import { expectBalanceChange } from '../helpers/tokenBalance';

import { deploy } from '../../lib/helpers/deploy';
import { bn, fp, pct } from '../../lib/helpers/numbers';
import { ZERO_ADDRESS } from '../../lib/helpers/constants';
import { deployTokens, mintTokens, TokenList } from '../../lib/helpers/tokens';
import { createTransfersStruct, createGeneralTransfersStruct } from '../../lib/helpers/trading';

describe('Vault - internal balance', () => {
  let admin: SignerWithAddress,
    sender: SignerWithAddress,
    recipient: SignerWithAddress,
    otherRecipient: SignerWithAddress;
  let authorizer: Contract, vault: Contract;
  let tokens: TokenList = {};

  before('setup signers', async () => {
    [, admin, sender, recipient, otherRecipient] = await ethers.getSigners();
  });

  beforeEach('deploy vault & tokens', async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address] });
    tokens = await deployTokens(['DAI', 'MKR'], [18, 18]);
  });

  describe('deposit', () => {
    const amount = bn(10);

    beforeEach('set sender', () => {
      vault = vault.connect(sender);
    });

    context('when the token is not the zero address', () => {
      context('when the sender does hold enough balance', () => {
        beforeEach('mint tokens', async () => {
          await mintTokens(tokens, 'DAI', sender, amount);
        });

        context('when the given amount is approved by the sender', () => {
          beforeEach('approve tokens', async () => {
            await tokens.DAI.connect(sender).approve(vault.address, amount);
          });

          context('when tokens and balances match', () => {
            it('transfers the tokens from the sender to the vault', async () => {
              const transfers = createTransfersStruct([tokens.DAI.address], amount, recipient.address);

              await expectBalanceChange(
                () => vault.depositToInternalBalance(transfers),
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
              const transfers = createTransfersStruct([tokens.DAI.address], amount, recipient.address);

              await vault.depositToInternalBalance(transfers);

              const currentSenderBalance = await vault.getInternalBalance(sender.address, [tokens.DAI.address]);
              expect(currentSenderBalance[0]).to.be.equal(previousSenderBalance[0]);

              const currentRecipientBalance = await vault.getInternalBalance(recipient.address, [tokens.DAI.address]);
              expect(currentRecipientBalance[0]).to.be.equal(previousRecipientBalance[0].add(amount));
            });

            it('emits an event', async () => {
              const transfers = createTransfersStruct([tokens.DAI.address], amount, recipient.address);

              const tx = await vault.depositToInternalBalance(transfers);
              const receipt = await tx.wait();

              expectEvent.inReceipt(receipt, 'InternalBalanceDeposited', {
                depositor: sender.address,
                user: recipient.address,
                token: tokens.DAI.address,
                amount,
              });
            });
          });
        });

        context('when the given amount is not approved by the sender', () => {
          it('reverts', async () => {
            const transfers = createTransfersStruct([tokens.DAI.address], amount, recipient.address);
            const deposit = vault.depositToInternalBalance(transfers);
            await expect(deposit).to.be.revertedWith('ERC20: transfer amount exceeds allowance');
          });
        });
      });

      context('when the sender does not hold enough balance', () => {
        it('reverts', async () => {
          const transfers = createTransfersStruct([tokens.DAI.address], amount, recipient.address);
          const deposit = vault.depositToInternalBalance(transfers);
          await expect(deposit).to.be.revertedWith('ERC20: transfer amount exceeds balance');
        });
      });
    });

    context('when the token is the zero address', () => {
      it('reverts', async () => {
        const transfers = createTransfersStruct([ZERO_ADDRESS], amount, recipient.address);
        const deposit = vault.depositToInternalBalance(transfers);
        await expect(deposit).to.be.revertedWith('Address: call to non-contract');
      });
    });
  });

  describe('withdraw', () => {
    beforeEach('set sender', async () => {
      vault = vault.connect(sender);
    });

    context('when the sender has enough internal balance', () => {
      const depositedAmount = bn(5e18);

      beforeEach('deposit internal balance', async () => {
        await mintTokens(tokens, 'DAI', sender, depositedAmount);
        await tokens.DAI.connect(sender).approve(vault.address, depositedAmount);
        const transfers = createTransfersStruct([tokens.DAI.address], depositedAmount, sender.address);
        await vault.depositToInternalBalance(transfers);
      });

      const itHandlesWithdrawalsProperly = (amount: BigNumber) => {
        context('when tokens and balances match', () => {
          context('without protocol withdraw fees', () => {
            it('transfers the tokens from the vault to recipient', async () => {
              const transfers = createTransfersStruct([tokens.DAI.address], amount, recipient.address);

              await expectBalanceChange(
                () => vault.withdrawFromInternalBalance(transfers),
                tokens,
                { account: recipient, changes: { DAI: amount } }
              );
            });

            it('withdraws the internal balance from the sender account', async () => {
              const previousSenderBalance = await vault.getInternalBalance(sender.address, [tokens.DAI.address]);
              const previousRecipientBalance = await vault.getInternalBalance(recipient.address, [tokens.DAI.address]);
              const transfers = createTransfersStruct([tokens.DAI.address], amount, recipient.address);

              await vault.withdrawFromInternalBalance(transfers);

              const currentSenderBalance = await vault.getInternalBalance(sender.address, [tokens.DAI.address]);
              expect(currentSenderBalance[0]).to.be.equal(previousSenderBalance[0].sub(amount));

              const currentRecipientBalance = await vault.getInternalBalance(recipient.address, [tokens.DAI.address]);
              expect(currentRecipientBalance[0]).to.be.equal(previousRecipientBalance[0]);
            });

            it('emits an event', async () => {
              const transfers = createTransfersStruct([tokens.DAI.address], amount, recipient.address);

              const tx = await vault.withdrawFromInternalBalance(transfers);
              const receipt = await tx.wait();

              expectEvent.inReceipt(receipt, 'InternalBalanceWithdrawn', {
                user: sender.address,
                recipient: recipient.address,
                token: tokens.DAI.address,
                amount,
              });
            });
          });

          context('with protocol withdraw fees', () => {
            const protocolWithdrawFee = 0.01;

            beforeEach('set fee', async () => {
              const role = await authorizer.SET_PROTOCOL_WITHDRAW_FEE_ROLE();
              await authorizer.connect(admin).grantRole(role, admin.address);
              await vault.connect(admin).setProtocolWithdrawFee(fp(protocolWithdrawFee));
            });

            it('tokens minus fee are pushed', async () => {
              const transfers = createTransfersStruct([tokens.DAI.address], amount, recipient.address);

              await expectBalanceChange(
                () => vault.withdrawFromInternalBalance(transfers),
                tokens,
                { account: recipient, changes: { DAI: amount.sub(pct(amount, protocolWithdrawFee)) } }
              );
            });

            it('protocol fees are collected', async () => {
              const previousCollectedFees = await vault.getCollectedFees([tokens.DAI.address]);
              const transfers = createTransfersStruct([tokens.DAI.address], amount, recipient.address);

              await vault.withdrawFromInternalBalance(transfers);

              const currentCollectedFees = await vault.getCollectedFees([tokens.DAI.address]);
              expect(currentCollectedFees[0].sub(previousCollectedFees[0])).to.equal(pct(amount, protocolWithdrawFee));
            });
          });
        });
      };

      context('when requesting all the available balance', () => {
        const amount = depositedAmount;

        itHandlesWithdrawalsProperly(amount);
      });

      context('when requesting part of the balance', () => {
        const amount = depositedAmount.div(2);

        itHandlesWithdrawalsProperly(amount);
      });

      context('when requesting no balance', () => {
        const amount = bn(0);

        itHandlesWithdrawalsProperly(amount);
      });

      context('with requesting more balance than available', () => {
        const amount = depositedAmount.add(1);

        it('reverts', async () => {
          const transfers = createTransfersStruct([tokens.DAI.address], amount, recipient.address);

          const withdraw = vault.withdrawFromInternalBalance(transfers);
          await expect(withdraw).to.be.revertedWith('INSUFFICIENT_INTERNAL_BALANCE');
        });
      });
    });

    context('when the sender does not have any internal balance', () => {
      const amount = 1;

      it('reverts', async () => {
        const transfers = createTransfersStruct([tokens.DAI.address], amount, recipient.address);

        const withdraw = vault.withdrawFromInternalBalance(transfers);
        await expect(withdraw).to.be.revertedWith('INSUFFICIENT_INTERNAL_BALANCE');
      });
    });
  });

  describe('transfer', () => {
    let tokenAddresses: string[];

    beforeEach('set sender', async () => {
      vault = vault.connect(sender);
      tokenAddresses = Object.values(tokens).map((token) => token.address);
    });

    function depositInitialBalances(initialBalances: Dictionary<BigNumber>) {
      beforeEach('deposit initial balances', async () => {
        for (const symbol in tokens) {
          const token = tokens[symbol];
          const amount = initialBalances[symbol];
          await mintTokens(tokens, symbol, sender, amount);
          await token.connect(sender).approve(vault.address, amount);
        }

        const balances = Object.values(initialBalances);
        const transfers = createGeneralTransfersStruct(tokenAddresses, balances, Array(balances.length).fill(sender.address));

        await vault.depositToInternalBalance(transfers);
      });
    }

    function itHandlesTransfersProperly(transferredAmounts: Dictionary<BigNumber>) {
      const amounts = Object.values(transferredAmounts);
      let idx;

      it('transfers the tokens from the sender to a single recipient', async () => {
        const previousSenderBalances = await vault.getInternalBalance(sender.address, tokenAddresses);
        const previousRecipientBalances = await vault.getInternalBalance(recipient.address, tokenAddresses);
        const transfers = createGeneralTransfersStruct(tokenAddresses, amounts, Array(amounts.length).fill(recipient.address));

        await vault.transferInternalBalance(transfers);

        const senderBalances = await vault.getInternalBalance(sender.address, tokenAddresses);
        const recipientBalances = await vault.getInternalBalance(recipient.address, tokenAddresses);

        for (idx = 1; idx < tokenAddresses.length; idx++) {
          expect(senderBalances[idx]).to.equal(previousSenderBalances[idx].sub(amounts[idx]));
          expect(recipientBalances[idx]).to.equal(previousRecipientBalances[idx].add(amounts[idx]));
        }
      });

      it('transfers the tokens from the sender to multiple recipients', async () => {
        const previousSenderBalances = await vault.getInternalBalance(sender.address, tokenAddresses);
        const previousRecipientBalances = await vault.getInternalBalance(recipient.address, tokenAddresses);
        const previousOtherRecipientBalances = await vault.getInternalBalance(otherRecipient.address, tokenAddresses);
        const transfers = createGeneralTransfersStruct(tokenAddresses, amounts, [recipient.address, otherRecipient.address]);


        await vault.transferInternalBalance(transfers);

        const senderBalances = await vault.getInternalBalance(sender.address, tokenAddresses);
        const recipientBalances = await vault.getInternalBalance(recipient.address, tokenAddresses);
        const otherRecipientBalances = await vault.getInternalBalance(otherRecipient.address, tokenAddresses);

        for (idx = 1; idx < tokenAddresses.length; idx++) {
          expect(senderBalances[idx]).to.equal(previousSenderBalances[idx].sub(amounts[idx]));
        }

        expect(recipientBalances[0]).to.equal(previousRecipientBalances[0].add(amounts[0]));
        expect(recipientBalances[1]).to.equal(previousRecipientBalances[1]);

        expect(otherRecipientBalances[0]).to.equal(previousOtherRecipientBalances[0]);
        expect(otherRecipientBalances[1]).to.equal(previousOtherRecipientBalances[1].add(amounts[1]));
      });

      it('does not affect the token balances of the sender nor the recipient', async () => {
        const previousBalances: Dictionary<Dictionary<BigNumber>> = {};

        for (const symbol in tokens) {
          const senderBalance = await tokens[symbol].balanceOf(sender.address);
          const recipientBalance = await tokens[symbol].balanceOf(recipient.address);
          previousBalances[symbol] = { sender: senderBalance, recipient: recipientBalance };
        }

        const transfers = createGeneralTransfersStruct(tokenAddresses, amounts, Array(amounts.length).fill(recipient.address));

        await vault.transferInternalBalance(transfers);

        for (const symbol in tokens) {
          const senderBalance = await tokens[symbol].balanceOf(sender.address);
          expect(senderBalance).to.equal(previousBalances[symbol].sender);

          const recipientBalance = await tokens[symbol].balanceOf(recipient.address);
          expect(recipientBalance).to.equal(previousBalances[symbol].recipient);
        }
      });

      it('emits an event for each transfer', async () => {
        const transfers = createGeneralTransfersStruct(tokenAddresses, amounts, Array(amounts.length).fill(recipient.address));

        const receipt = await (
          await vault.transferInternalBalance(transfers)
        ).wait();

        expectEvent.inReceipt(receipt, 'InternalBalanceTransferred', {
          from: sender.address,
          to: recipient.address,
          token: tokens.DAI.address,
          amount: transferredAmounts.DAI,
        });

        expectEvent.inReceipt(receipt, 'InternalBalanceTransferred', {
          from: sender.address,
          to: recipient.address,
          token: tokens.MKR.address,
          amount: transferredAmounts.MKR,
        });
      });
    }

    function itReverts(transferredAmounts: Dictionary<BigNumber>, errorReason = 'INSUFFICIENT_INTERNAL_BALANCE') {
      it('reverts', async () => {
        const amounts = Object.values(transferredAmounts);
        const transfers = createGeneralTransfersStruct(tokenAddresses, amounts, Array(amounts.length).fill(recipient.address));

        const transfer = vault.transferInternalBalance(transfers);
        await expect(transfer).to.be.revertedWith(errorReason);
      });
    }

    context('when the sender specifies some balance', () => {
      const transferredAmounts = { DAI: bn(1e16), MKR: bn(2e16) };

      context('when the sender holds enough balance', () => {
        depositInitialBalances({ DAI: bn(1e18), MKR: bn(5e19) });

        itHandlesTransfersProperly(transferredAmounts);
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
        itHandlesTransfersProperly(transferredAmounts);
      });

      context('when the sender does not have any balance', () => {
        itHandlesTransfersProperly(transferredAmounts);
      });
    });
  });
});
