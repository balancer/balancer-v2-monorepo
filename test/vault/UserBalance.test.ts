import { ethers, deployments } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import * as expectEvent from '../helpers/expectEvent';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { TokenList, deployTokens } from '../helpers/tokens';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { toFixedPoint } from '../../scripts/helpers/fixedPoint';
import { deploy } from '../../scripts/helpers/deploy';

describe('Vault - user balance', () => {
  let admin: SignerWithAddress;
  let trader: SignerWithAddress;
  let user: SignerWithAddress;
  let operator: SignerWithAddress;
  let reporter: SignerWithAddress;
  let trustedOperator: SignerWithAddress;
  let other: SignerWithAddress;

  let vault: Contract;
  let tokens: TokenList = {};

  before('setup', async () => {
    [admin, trader, user, operator, reporter, trustedOperator, other] = await ethers.getSigners();
  });

  const amount = BigNumber.from(500);

  describe('deposit & withdraw', () => {
    beforeEach('deploy vault & tokens', async () => {
      vault = await deploy('Vault', { from: admin, args: [admin.address] });
      tokens = await deployTokens(['DAI', 'MKR'], [18, 18], admin);

      await tokens['DAI'].connect(admin).mint(trader.address, amount.toString());
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
          () => vault.connect(user).withdraw(tokens.DAI.address, amount.sub(1), other.address),
          tokens,
          { account: other, changes: { DAI: amount.sub(1) } }
        );
      });

      it('user can withdraw all tokens', async () => {
        await expectBalanceChange(
          () => vault.connect(user).withdraw(tokens.DAI.address, amount, other.address),
          tokens,
          { account: other, changes: { DAI: amount } }
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

      context('with protocol withdraw fees', () => {
        const protocolWithdrawFee = 0.01;

        beforeEach(async () => {
          await vault.connect(admin).setProtocolWithdrawFee(toFixedPoint(protocolWithdrawFee));
        });

        it('tokens minus fee are pushed', async () => {
          await expectBalanceChange(
            () => vault.connect(user).withdraw(tokens.DAI.address, amount, other.address),
            tokens,
            { account: other, changes: { DAI: amount.toNumber() * (1 - protocolWithdrawFee) } }
          );
        });
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

  describe('trusted operators', () => {
    it('the vault starts with no trusted operators', async () => {
      expect(await vault.getTotalTrustedOperators()).to.equal(0);
    });

    it('the vault starts with no reporters', async () => {
      expect(await vault.getTotalTrustedOperatorReporters()).to.equal(0);
    });

    context('with trusted operator reporter', () => {
      beforeEach(async () => {
        await vault.connect(admin).authorizeTrustedOperatorReporter(reporter.address);
      });

      it('reporters can be queried', async () => {
        expect(await vault.getTotalTrustedOperatorReporters()).to.equal(1);
        expect(await vault.getTrustedOperatorReporters(0, 1)).to.have.members([reporter.address]);
      });

      it('reporter can report new trusted operators', async () => {
        await vault.connect(reporter).reportTrustedOperator(trustedOperator.address);

        expect(await vault.getTotalTrustedOperators()).to.equal(1);
        expect(await vault.getTrustedOperators(0, 1)).to.have.members([trustedOperator.address]);
      });

      it('non-reporter cannot report new trusted operators', async () => {
        await expect(vault.connect(other).reportTrustedOperator(trustedOperator.address)).to.be.revertedWith(
          'Caller is not trusted operator reporter'
        );
      });

      context('with trusted operator', () => {
        beforeEach(async () => {
          await vault.connect(reporter).reportTrustedOperator(trustedOperator.address);
        });

        it('trusted operators are operators for all accounts', async () => {
          expect(await vault.isOperatorFor(other.address, trustedOperator.address)).to.equal(true);
        });

        it('revoking trusted operators as regular operators does nothing', async () => {
          await vault.connect(other).revokeOperator(trustedOperator.address);
          expect(await vault.isOperatorFor(other.address, trustedOperator.address)).to.equal(true);
        });

        it('reporter can revoke trusted operators', async () => {
          await vault.connect(reporter).revokeTrustedOperator(trustedOperator.address);

          expect(await vault.getTotalTrustedOperators()).to.equal(0);
        });

        it('non-reporter cannot revoke trusted operators', async () => {
          await expect(vault.connect(other).revokeTrustedOperator(trustedOperator.address)).to.be.revertedWith(
            'Caller is not trusted operator reporter'
          );
        });
      });
    });
  });
});
