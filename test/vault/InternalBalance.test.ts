import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Dictionary } from 'lodash';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { bn, fp, pct } from '../helpers/numbers';
import { deploy } from '../../scripts/helpers/deploy';
import * as expectEvent from '../helpers/expectEvent';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { MAX_UINT128, ZERO_ADDRESS } from '../helpers/constants';
import { deployTokens, mintTokens, TokenList } from '../helpers/tokens';

describe('Vault - internal balance', () => {
  let admin: SignerWithAddress, sender: SignerWithAddress, recipient: SignerWithAddress;
  let authorizer: Contract, vault: Contract;
  let tokens: TokenList = {};

  before('setup signers', async () => {
    [, admin, sender, recipient] = await ethers.getSigners();
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

          it('transfers the tokens from the sender to the vault', async () => {
            await expectBalanceChange(
              () => vault.depositToInternalBalance(tokens.DAI.address, amount, recipient.address),
              tokens,
              [
                { account: sender.address, changes: { DAI: -amount } },
                { account: vault.address, changes: { DAI: amount } },
              ]
            );
          });

          it('deposits the internal balance into the recipient account', async () => {
            const previousSenderBalance = await vault.getInternalBalance(sender.address, tokens.DAI.address);
            const previousRecipientBalance = await vault.getInternalBalance(recipient.address, tokens.DAI.address);

            await vault.depositToInternalBalance(tokens.DAI.address, amount, recipient.address);

            const currentSenderBalance = await vault.getInternalBalance(sender.address, tokens.DAI.address);
            expect(currentSenderBalance).to.be.equal(previousSenderBalance);

            const currentRecipientBalance = await vault.getInternalBalance(recipient.address, tokens.DAI.address);
            expect(currentRecipientBalance).to.be.equal(previousRecipientBalance.add(amount));
          });

          it('emits an event', async () => {
            const tx = await vault.depositToInternalBalance(tokens.DAI.address, amount, recipient.address);
            const receipt = await tx.wait();

            expectEvent.inReceipt(receipt, 'Deposited', {
              depositor: sender.address,
              user: recipient.address,
              token: tokens.DAI.address,
              amount,
            });
          });
        });

        context('when the given amount is not approved by the sender', () => {
          it('reverts', async () => {
            const deposit = vault.depositToInternalBalance(tokens.DAI.address, amount, recipient.address);
            await expect(deposit).to.be.revertedWith('ERC20: transfer amount exceeds allowance');
          });
        });
      });

      context('when the sender does not hold enough balance', () => {
        it('reverts', async () => {
          const deposit = vault.depositToInternalBalance(tokens.DAI.address, amount, recipient.address);
          await expect(deposit).to.be.revertedWith('ERC20: transfer amount exceeds balance');
        });
      });
    });

    context('when the token is the zero address', () => {
      const token = ZERO_ADDRESS;

      it('reverts', async () => {
        const deposit = vault.depositToInternalBalance(token, amount, recipient.address);
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
        await vault.depositToInternalBalance(tokens.DAI.address, depositedAmount, sender.address);
      });

      const itHandlesWithdrawsProperly = (amount: BigNumber) => {
        context('without protocol withdraw fees', () => {
          it('transfers the tokens from the vault to recipient', async () => {
            await expectBalanceChange(
              () => vault.withdrawFromInternalBalance(tokens.DAI.address, amount, recipient.address),
              tokens,
              { account: recipient, changes: { DAI: amount } }
            );
          });

          it('withdraws the internal balance from the sender account', async () => {
            const previousSenderBalance = await vault.getInternalBalance(sender.address, tokens.DAI.address);
            const previousRecipientBalance = await vault.getInternalBalance(recipient.address, tokens.DAI.address);

            await vault.withdrawFromInternalBalance(tokens.DAI.address, amount, recipient.address);

            const currentSenderBalance = await vault.getInternalBalance(sender.address, tokens.DAI.address);
            expect(currentSenderBalance).to.be.equal(previousSenderBalance.sub(amount));

            const currentRecipientBalance = await vault.getInternalBalance(recipient.address, tokens.DAI.address);
            expect(previousRecipientBalance).to.be.equal(currentRecipientBalance);
          });

          it('emits an event', async () => {
            const tx = await vault.withdrawFromInternalBalance(tokens.DAI.address, amount, recipient.address);
            const receipt = await tx.wait();

            expectEvent.inReceipt(receipt, 'Withdrawn', {
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
            await expectBalanceChange(
              () => vault.withdrawFromInternalBalance(tokens.DAI.address, amount, recipient.address),
              tokens,
              { account: recipient, changes: { DAI: amount.sub(pct(amount, protocolWithdrawFee)) } }
            );
          });
        });
      };

      context('when requesting all the available balance', () => {
        const amount = depositedAmount;

        itHandlesWithdrawsProperly(amount);
      });

      context('when requesting part of the balance', () => {
        const amount = depositedAmount.div(2);

        itHandlesWithdrawsProperly(amount);
      });

      context('when requesting no balance', () => {
        const amount = bn(0);

        itHandlesWithdrawsProperly(amount);
      });
    });

    context('when the sender does not have enough internal balance', () => {
      const amount = depositedAmount.add(1);

      it('reverts', async () => {
        const withdraw = vault.withdrawFromInternalBalance(tokens.DAI.address, amount, recipient.address);
        await expect(withdraw).to.be.revertedWith('Vault: withdraw amount exceeds balance');
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
          await vault.depositToInternalBalance(token.address, amount, sender.address);
        }
      });
    }

    function itHandlesTransfersProperly(transferredAmounts: Dictionary<BigNumber>) {
      const amounts = Object.values(transferredAmounts);

      it('transfers the tokens from the sender to the recipient', async () => {
        const previousBalances: Dictionary<Dictionary<BigNumber>> = {};

        for (const symbol in tokens) {
          const senderBalance = await vault.getInternalBalance(sender.address, tokens[symbol].address);
          const recipientBalance = await vault.getInternalBalance(recipient.address, tokens[symbol].address);
          previousBalances[symbol] = { sender: senderBalance, recipient: recipientBalance };
        }

        await vault.transferInternalBalance(tokenAddresses, amounts, recipient.address);

        for (const symbol in tokens) {
          const senderBalance = await vault.getInternalBalance(sender.address, tokens[symbol].address);
          expect(senderBalance).to.equal(previousBalances[symbol].sender.sub(transferredAmounts[symbol]));

          const recipientBalance = await vault.getInternalBalance(recipient.address, tokens[symbol].address);
          expect(recipientBalance).to.equal(previousBalances[symbol].recipient.add(transferredAmounts[symbol]));
        }
      });

      it('does not affect the token balances of the sender nor the recipient', async () => {
        const previousBalances: Dictionary<Dictionary<BigNumber>> = {};

        for (const symbol in tokens) {
          const senderBalance = await tokens[symbol].balanceOf(sender.address);
          const recipientBalance = await tokens[symbol].balanceOf(recipient.address);
          previousBalances[symbol] = { sender: senderBalance, recipient: recipientBalance };
        }

        await vault.transferInternalBalance(tokenAddresses, amounts, recipient.address);

        for (const symbol in tokens) {
          const senderBalance = await tokens[symbol].balanceOf(sender.address);
          expect(senderBalance).to.equal(previousBalances[symbol].sender);

          const recipientBalance = await tokens[symbol].balanceOf(recipient.address);
          expect(recipientBalance).to.equal(previousBalances[symbol].recipient);
        }
      });

      it('emits an event for each transfer', async () => {
        const receipt = await (await vault.transferInternalBalance(tokenAddresses, amounts, recipient.address)).wait();

        expectEvent.inReceipt(receipt, 'Transferred', {
          from: sender.address,
          to: recipient.address,
          token: tokens.DAI.address,
          amount: transferredAmounts.DAI,
        });

        expectEvent.inReceipt(receipt, 'Transferred', {
          from: sender.address,
          to: recipient.address,
          token: tokens.MKR.address,
          amount: transferredAmounts.MKR,
        });
      });
    }

    function itReverts(transferredAmounts: Dictionary<BigNumber>, errorReason = 'ERR_NOT_ENOUGH_INTERNAL_BALANCE') {
      it('reverts', async () => {
        const amounts = Object.values(transferredAmounts);
        const transfer = vault.transferInternalBalance(tokenAddresses, amounts, recipient.address);
        await expect(transfer).to.be.revertedWith(errorReason);
      });
    }

    context('when the sender specifies some balance', () => {
      const transferredAmounts = { DAI: bn(1e16), MKR: bn(2e16) };

      context('when the sender holds enough balance', () => {
        depositInitialBalances({ DAI: bn(1e18), MKR: bn(5e19) });

        context('when the recipient can hold more tokens', () => {
          itHandlesTransfersProperly(transferredAmounts);
        });

        context('when the recipient cannot hold any more tokens', () => {
          beforeEach('deposit huge amount to recipient', async () => {
            await mintTokens(tokens, 'DAI', recipient, MAX_UINT128);
            await tokens.DAI.connect(recipient).approve(vault.address, MAX_UINT128);
            await vault.connect(recipient).depositToInternalBalance(tokens.DAI.address, MAX_UINT128, recipient.address);
          });

          itReverts(transferredAmounts, 'ERR_ADD_OVERFLOW');
        });
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
