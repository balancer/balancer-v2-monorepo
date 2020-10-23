import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import * as expectEvent from '../helpers/expectEvent';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { TokenList, deployTokens, mintTokens } from '../helpers/tokens';
import { deploy } from '../../scripts/helpers/deploy';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

describe('Vault - user balance', () => {
  let trader: SignerWithAddress;
  let user: SignerWithAddress;
  let operator: SignerWithAddress;
  let other: SignerWithAddress;

  let vault: Contract;
  let tokens: TokenList = {};

  before('setup', async () => {
    [, trader, user, operator, other] = await ethers.getSigners();
  });

  const amount = ethers.BigNumber.from(500);

  describe('deposit & withdraw', () => {
    beforeEach('deploy vault & tokens', async () => {
      vault = await deploy('Vault');
      tokens = await deployTokens(['DAI', 'MKR']);

      await mintTokens(tokens, 'DAI', trader, amount.toString());
    });

    it('user can deposit tokens', async () => {
      await tokens.DAI.connect(trader).approve(vault.address, amount);
      const receipt = await (await vault.connect(trader).deposit(tokens.DAI.address, amount, user.address)).wait();

      expectEvent.inReceipt(receipt, 'Deposited', {
        depositor: trader.address,
        user: user.address,
        token: tokens.DAI.address,
        amount,
      });
    });

    it('user must approve before depositing tokens', async () => {
      await expect(vault.connect(trader).deposit(tokens.DAI.address, amount, user.address)).to.be.revertedWith(
        'ERC20: transfer amount exceeds allowance'
      );
    });

    context('with deposited tokens', () => {
      beforeEach(async () => {
        await tokens.DAI.connect(trader).approve(vault.address, amount);
        await vault.connect(trader).deposit(tokens.DAI.address, amount, user.address);
      });

      it('credit can be queried', async () => {
        expect(await vault.getUserTokenBalance(user.address, tokens.DAI.address)).to.equal(amount);
      });

      it('tokens are not credited to the account that deposits', async () => {
        expect(await vault.getUserTokenBalance(trader.address, tokens.DAI.address)).to.equal(0);
      });

      it('user can withdraw tokens to any address', async () => {
        const receipt = await (await vault.connect(user).withdraw(tokens.DAI.address, amount, other.address)).wait();

        expectEvent.inReceipt(receipt, 'Withdrawn', {
          user: user.address,
          recipient: other.address,
          token: tokens.DAI.address,
          amount,
        });
      });

      it('user can withdraw partial tokens', async () => {
        await expectBalanceChange(
          async () => {
            await vault.connect(user).withdraw(tokens.DAI.address, amount.sub(1), other.address);
          },
          other,
          tokens,
          { DAI: amount.sub(1) }
        );
      });

      it('user can withdraw all tokens', async () => {
        await expectBalanceChange(
          async () => {
            await vault.connect(user).withdraw(tokens.DAI.address, amount, other.address);
          },
          other,
          tokens,
          { DAI: amount }
        );
      });

      it('withdrawal updates balance', async () => {
        await vault.connect(user).withdraw(tokens.DAI.address, amount.sub(1), other.address);
        expect(await vault.getUserTokenBalance(user.address, tokens.DAI.address)).to.equal(1);
      });

      it('user cannot overwithdraw', async () => {
        await expect(vault.connect(user).withdraw(tokens.DAI.address, amount.add(1), other.address)).to.be.revertedWith(
          'Vault: withdraw amount exceeds balance'
        );
      });

      it('depositor cannot withdraw tokens', async () => {
        await expect(vault.connect(trader).withdraw(tokens.DAI.address, amount, other.address)).to.be.revertedWith(
          'Vault: withdraw amount exceeds balance'
        );
      });
    });
  });

  describe('operators', () => {
    it('accounts start with no operators', async () => {
      expect(await vault.getUserTotalOperators(user.address)).to.equal(0);
    });

    it('accounts are their own operator', async () => {
      expect(await vault.isOperatorFor(user.address, user.address)).to.equal(true);
    });

    it('accounts can add operators', async () => {
      expect(await vault.isOperatorFor(user.address, operator.address)).to.equal(false);

      const receipt = await (await vault.connect(user).authorizeOperator(operator.address)).wait();
      expectEvent.inReceipt(receipt, 'AuthorizedOperator', {
        user: user.address,
        operator: operator.address,
      });

      expect(await vault.isOperatorFor(user.address, operator.address)).to.equal(true);
    });

    context('with operators', () => {
      beforeEach('authorize operator', async () => {
        await vault.connect(user).authorizeOperator(operator.address);
      });

      it('operators can be listed', async () => {
        const amount = await vault.getUserTotalOperators(user.address);
        const operators = await vault.getUserOperators(user.address, 0, amount);

        expect(operators).to.have.members([operator.address]);
      });

      it('new operators can be added to the list', async () => {
        await vault.connect(user).authorizeOperator(other.address);

        const amount = await vault.getUserTotalOperators(user.address);
        const operators = await vault.getUserOperators(user.address, 0, amount);

        expect(operators).to.have.members([operator.address, other.address]);
      });

      it('accounts can revoke operators', async () => {
        const receipt = await (await vault.connect(user).revokeOperator(operator.address)).wait();
        expectEvent.inReceipt(receipt, 'RevokedOperator', {
          user: user.address,
          operator: operator.address,
        });

        expect(await vault.isOperatorFor(user.address, operator.address)).to.equal(false);
      });
    });
  });
});
