import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '../../scripts/helpers/deploy';
import { MAX_UINT128 } from '../helpers/constants';
import * as expectEvent from '../helpers/expectEvent';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { toFixedPoint } from '../../scripts/helpers/fixedPoint';
import { deployTokens, mintTokens, TokenList } from '../helpers/tokens';

describe('Vault - internal balance', () => {
  let admin: SignerWithAddress;
  let trader: SignerWithAddress;
  let user: SignerWithAddress;
  let feeSetter: SignerWithAddress;
  let other: SignerWithAddress;

  let authorizer: Contract;
  let vault: Contract;
  let tokens: TokenList = {};

  before('setup', async () => {
    [, admin, trader, user, feeSetter, other] = await ethers.getSigners();
  });

  const amount = BigNumber.from(500);

  beforeEach('deploy vault & tokens', async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address] });

    tokens = await deployTokens(['DAI', 'MKR'], [18, 18]);

    await mintTokens(tokens, 'DAI', trader, amount.toString());
  });

  describe('deposit', () => {
    it('user can deposit tokens', async () => {
      await tokens.DAI.connect(trader).approve(vault.address, amount);
      const receipt = await (
        await vault.connect(trader).depositToInternalBalance(tokens.DAI.address, amount, user.address)
      ).wait();

      expectEvent.inReceipt(receipt, 'Deposited', {
        depositor: trader.address,
        user: user.address,
        token: tokens.DAI.address,
        amount,
      });
    });

    it('user must approve before depositing tokens', async () => {
      await expect(
        vault.connect(trader).depositToInternalBalance(tokens.DAI.address, amount, user.address)
      ).to.be.revertedWith('ERC20: transfer amount exceeds allowance');
    });

    it('updates the internal balance of the deposited account', async () => {
      await tokens.DAI.connect(trader).approve(vault.address, amount);
      await vault.connect(trader).depositToInternalBalance(tokens.DAI.address, amount, user.address);

      expect(await vault.getInternalBalance(user.address, tokens.DAI.address)).to.equal(amount);
      expect(await vault.getInternalBalance(trader.address, tokens.DAI.address)).to.equal(0);
    });
  });

  describe('withdraw', () => {
    beforeEach(async () => {
      await tokens.DAI.connect(trader).approve(vault.address, amount);
      await vault.connect(trader).depositToInternalBalance(tokens.DAI.address, amount, user.address);
    });

    it('user can withdraw tokens to any address', async () => {
      const receipt = await (
        await vault.connect(user).withdrawFromInternalBalance(tokens.DAI.address, amount, other.address)
      ).wait();

      expectEvent.inReceipt(receipt, 'Withdrawn', {
        user: user.address,
        recipient: other.address,
        token: tokens.DAI.address,
        amount,
      });
    });

    it('user can withdraw partial tokens', async () => {
      await expectBalanceChange(
        () => vault.connect(user).withdrawFromInternalBalance(tokens.DAI.address, amount.sub(1), other.address),
        tokens,
        { account: other, changes: { DAI: amount.sub(1) } }
      );
    });

    it('user can withdraw all tokens', async () => {
      await expectBalanceChange(
        () => vault.connect(user).withdrawFromInternalBalance(tokens.DAI.address, amount, other.address),
        tokens,
        {
          account: other,
          changes: { DAI: amount },
        }
      );
    });

    it('withdrawal updates balance', async () => {
      await vault.connect(user).withdrawFromInternalBalance(tokens.DAI.address, amount.sub(1), other.address);
      expect(await vault.getInternalBalance(user.address, tokens.DAI.address)).to.equal(1);
    });

    it('user cannot overwithdraw', async () => {
      await expect(
        vault.connect(user).withdrawFromInternalBalance(tokens.DAI.address, amount.add(1), other.address)
      ).to.be.revertedWith('Vault: withdraw amount exceeds balance');
    });

    it('depositor cannot withdraw tokens', async () => {
      await expect(
        vault.connect(trader).withdrawFromInternalBalance(tokens.DAI.address, amount, other.address)
      ).to.be.revertedWith('Vault: withdraw amount exceeds balance');
    });

    context('with protocol withdraw fees', () => {
      const protocolWithdrawFee = 0.01;

      beforeEach(async () => {
        await authorizer.connect(admin).grantRole(await authorizer.SET_PROTOCOL_WITHDRAW_FEE_ROLE(), feeSetter.address);
        await vault.connect(feeSetter).setProtocolWithdrawFee(toFixedPoint(protocolWithdrawFee));
      });

      it('tokens minus fee are pushed', async () => {
        await expectBalanceChange(
          () => vault.connect(user).withdrawFromInternalBalance(tokens.DAI.address, amount, other.address),
          tokens,
          { account: other, changes: { DAI: amount.toNumber() * (1 - protocolWithdrawFee) } }
        );
      });
    });
  });

  describe('transfer', () => {
    let tokenAddresses: string[];

    beforeEach('set sender', async () => {
      vault = vault.connect(trader);
      tokenAddresses = Object.values(tokens).map((token) => token.address);
    });

    function depositInitialBalances(initialBalances: any) {
      beforeEach('deposit initial balances', async () => {
        for (const symbol in tokens) {
          const token = tokens[symbol];
          const amount = initialBalances[symbol];
          await mintTokens(tokens, symbol, trader, amount);
          await token.connect(trader).approve(vault.address, amount);
          await vault.connect(trader).depositToInternalBalance(token.address, amount, trader.address);
        }
      });
    }

    function itHandlesTransfersProperly(transferredAmounts: any, expectedAmounts = transferredAmounts) {
      const amounts = Object.values(transferredAmounts);

      context('when the recipient can hold more tokens', () => {
        it('transfers the tokens from the sender to the recipient', async () => {
          const previousBalances: any = {};

          for (const symbol in tokens) {
            const senderBalance = await vault.getInternalBalance(trader.address, tokens[symbol].address);
            const recipientBalance = await vault.getInternalBalance(user.address, tokens[symbol].address);
            previousBalances[symbol] = { sender: senderBalance, recipient: recipientBalance };
          }

          await vault.transferInternalBalance(tokenAddresses, amounts, user.address);

          for (const symbol in tokens) {
            const senderBalance = await vault.getInternalBalance(trader.address, tokens[symbol].address);
            expect(senderBalance).to.equal(previousBalances[symbol].sender.sub(expectedAmounts[symbol]));

            const recipientBalance = await vault.getInternalBalance(user.address, tokens[symbol].address);
            expect(recipientBalance).to.equal(previousBalances[symbol].recipient.add(expectedAmounts[symbol]));
          }
        });

        it('does not affect the token balances of the sender nor the recipient', async () => {
          const previousBalances: any = {};

          for (const symbol in tokens) {
            const senderBalance = await tokens[symbol].balanceOf(trader.address);
            const recipientBalance = await tokens[symbol].balanceOf(user.address);
            previousBalances[symbol] = { sender: senderBalance, recipient: recipientBalance };
          }

          await vault.transferInternalBalance(tokenAddresses, amounts, user.address);

          for (const symbol in tokens) {
            const senderBalance = await tokens[symbol].balanceOf(trader.address);
            expect(senderBalance).to.equal(previousBalances[symbol].sender);

            const recipientBalance = await tokens[symbol].balanceOf(user.address);
            expect(recipientBalance).to.equal(previousBalances[symbol].recipient);
          }
        });

        it('emits an event for each transfer', async () => {
          const receipt = await (await vault.transferInternalBalance(tokenAddresses, amounts, user.address)).wait();

          expectEvent.inReceipt(receipt, 'Transferred', {
            from: trader.address,
            to: user.address,
            token: tokens.DAI.address,
            amount: expectedAmounts.DAI,
          });

          expectEvent.inReceipt(receipt, 'Transferred', {
            from: trader.address,
            to: user.address,
            token: tokens.MKR.address,
            amount: expectedAmounts.MKR,
          });
        });
      });

      context('when the recipient cannot hold any more tokens', () => {
        beforeEach('deposit huge amount to recipient', async () => {
          await mintTokens(tokens, 'DAI', user, MAX_UINT128);
          await tokens.DAI.connect(user).approve(vault.address, MAX_UINT128);
          await vault.connect(user).depositToInternalBalance(tokens.DAI.address, MAX_UINT128, user.address);
        });

        it('reverts', async () => {
          const transfer = vault.transferInternalBalance(tokenAddresses, amounts, user.address);
          await expect(transfer).to.be.revertedWith('ERR_ADD_OVERFLOW');
        });
      });
    }

    function itReverts(transferredAmounts: any) {
      it('reverts', async () => {
        const transfer = vault.transferInternalBalance(tokenAddresses, Object.values(transferredAmounts), user.address);
        await expect(transfer).to.be.revertedWith('ERR_NOT_ENOUGH_INTERNAL_BALANCE');
      });
    }

    context('when the sender specifies some balance', () => {
      const transferredAmounts = { DAI: (1e16).toString(), MKR: (2e16).toString() };

      context('when the sender holds enough balance', () => {
        depositInitialBalances({ DAI: (1e18).toString(), MKR: (5e19).toString() });

        itHandlesTransfersProperly(transferredAmounts);
      });

      context('when the sender does not hold said balance', () => {
        context('when the sender does not hold enough balance of one token', () => {
          depositInitialBalances({ DAI: (10).toString(), MKR: (5e19).toString() });

          itReverts(transferredAmounts);
        });

        context('when the sender does not hold enough balance of the other token', () => {
          depositInitialBalances({ DAI: (1e18).toString(), MKR: (5).toString() });

          itReverts(transferredAmounts);
        });

        context('when the sender does not hold enough balance of both tokens', () => {
          depositInitialBalances({ DAI: (10).toString(), MKR: (5).toString() });

          itReverts(transferredAmounts);
        });
      });
    });

    context('when the sender does not specify any balance', () => {
      const transferredAmounts = { DAI: 0, MKR: 0 };

      context('when the sender holds some balance', () => {
        const initialBalances = { DAI: (1e18).toString(), MKR: (5e19).toString() };

        depositInitialBalances(initialBalances);
        itHandlesTransfersProperly(transferredAmounts, initialBalances);
      });

      context('when the sender does not have any balance', () => {
        itReverts(transferredAmounts);
      });
    });
  });
});
