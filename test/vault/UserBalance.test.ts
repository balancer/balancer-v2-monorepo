import { ethers } from '@nomiclabs/buidler';
import { expect } from 'chai';
import { Contract, Signer } from 'ethers';
import * as expectEvent from '../helpers/expectEvent';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { TokenList, deployTokens, mintTokens } from '../helpers/tokens';
import { deploy } from '../../scripts/helpers/deploy';

describe('Vault - user balance', () => {
  let trader: Signer;
  let user: Signer;
  let operator: Signer;
  let other: Signer;

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
      const receipt = await (
        await vault.connect(trader).deposit(tokens.DAI.address, amount, await user.getAddress())
      ).wait();

      expectEvent.inReceipt(receipt, 'Deposited', {
        depositor: await trader.getAddress(),
        user: await user.getAddress(),
        token: tokens.DAI.address,
        amount,
      });
    });

    it('user must approve before depositing tokens', async () => {
      await expect(
        vault.connect(trader).deposit(tokens.DAI.address, amount, await user.getAddress())
      ).to.be.revertedWith('ERC20: transfer amount exceeds allowance');
    });

    context('with deposited tokens', () => {
      beforeEach(async () => {
        await tokens.DAI.connect(trader).approve(vault.address, amount);
        await vault.connect(trader).deposit(tokens.DAI.address, amount, await user.getAddress());
      });

      it('credit can be queried', async () => {
        expect(await vault.getUserTokenBalance(await user.getAddress(), tokens.DAI.address)).to.equal(amount);
      });

      it('tokens are not credited to the account that deposits', async () => {
        expect(await vault.getUserTokenBalance(await trader.getAddress(), tokens.DAI.address)).to.equal(0);
      });

      it('user can withdraw tokens to any address', async () => {
        const receipt = await (
          await vault.connect(user).withdraw(tokens.DAI.address, amount, await other.getAddress())
        ).wait();

        expectEvent.inReceipt(receipt, 'Withdrawn', {
          user: await user.getAddress(),
          recipient: await other.getAddress(),
          token: tokens.DAI.address,
          amount,
        });
      });

      it('user can withdraw partial tokens', async () => {
        await expectBalanceChange(
          async () => {
            await vault.connect(user).withdraw(tokens.DAI.address, amount.sub(1), await other.getAddress());
          },
          other,
          tokens,
          { DAI: amount.sub(1) }
        );
      });

      it('user can withdraw all tokens', async () => {
        await expectBalanceChange(
          async () => {
            await vault.connect(user).withdraw(tokens.DAI.address, amount, await other.getAddress());
          },
          other,
          tokens,
          { DAI: amount }
        );
      });

      it('withdrawal updates balance', async () => {
        await vault.connect(user).withdraw(tokens.DAI.address, amount.sub(1), await other.getAddress());
        expect(await vault.getUserTokenBalance(await user.getAddress(), tokens.DAI.address)).to.equal(1);
      });

      it('user cannot overwithdraw', async () => {
        await expect(
          vault.connect(user).withdraw(tokens.DAI.address, amount.add(1), await other.getAddress())
        ).to.be.revertedWith('Vault: withdraw amount exceeds balance');
      });

      it('depositor cannot withdraw tokens', async () => {
        await expect(
          vault.connect(trader).withdraw(tokens.DAI.address, amount, await other.getAddress())
        ).to.be.revertedWith('Vault: withdraw amount exceeds balance');
      });
    });
  });

  describe('operators', () => {
    it('accounts start with no operators', async () => {
      expect(await vault.getUserTotalOperators(await user.getAddress())).to.equal(0);
    });

    it('accounts are their own operator', async () => {
      expect(await vault.isOperatorFor(await user.getAddress(), await user.getAddress())).to.equal(true);
    });

    it('accounts can add operators', async () => {
      expect(await vault.isOperatorFor(await user.getAddress(), await operator.getAddress())).to.equal(false);

      const receipt = await (await vault.connect(user).authorizeOperator(await operator.getAddress())).wait();
      expectEvent.inReceipt(receipt, 'AuthorizedOperator', {
        user: await user.getAddress(),
        operator: await operator.getAddress(),
      });

      expect(await vault.isOperatorFor(await user.getAddress(), await operator.getAddress())).to.equal(true);
    });

    context('with operators', () => {
      beforeEach('authorize operator', async () => {
        await vault.connect(user).authorizeOperator(await operator.getAddress());
      });

      it('operators can be listed', async () => {
        const amount = await vault.getUserTotalOperators(await user.getAddress());
        const operators = await vault.getUserOperators(await user.getAddress(), 0, amount);

        expect(operators).to.have.members([await operator.getAddress()]);
      });

      it('new operators can be added to the list', async () => {
        await vault.connect(user).authorizeOperator(await other.getAddress());

        const amount = await vault.getUserTotalOperators(await user.getAddress());
        const operators = await vault.getUserOperators(await user.getAddress(), 0, amount);

        expect(operators).to.have.members([await operator.getAddress(), await other.getAddress()]);
      });

      it('accounts can revoke operators', async () => {
        const receipt = await (await vault.connect(user).revokeOperator(await operator.getAddress())).wait();
        expectEvent.inReceipt(receipt, 'RevokedOperator', {
          user: await user.getAddress(),
          operator: await operator.getAddress(),
        });

        expect(await vault.isOperatorFor(await user.getAddress(), await operator.getAddress())).to.equal(false);
      });
    });
  });
});
