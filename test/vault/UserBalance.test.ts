import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import * as expectEvent from '../helpers/expectEvent';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { TokenList, deployTokens, mintTokens } from '../helpers/tokens';
import { deploy } from '../../scripts/helpers/deploy';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { toFixedPoint } from '../../scripts/helpers/fixedPoint';

describe('Vault - user balance', () => {
  let admin: SignerWithAddress;
  let trader: SignerWithAddress;
  let user: SignerWithAddress;
  let other: SignerWithAddress;

  let vault: Contract;
  let tokens: TokenList = {};

  before('setup', async () => {
    [, admin, trader, user, other] = await ethers.getSigners();
  });

  const amount = BigNumber.from(500);

  beforeEach('deploy vault & tokens', async () => {
    vault = await deploy('Vault', { from: admin, args: [admin.address] });
    tokens = await deployTokens(['DAI', 'MKR'], [18, 18]);

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
        () => vault.connect(user).withdraw(tokens.DAI.address, amount.sub(1), other.address),
        tokens,
        { account: other, changes: { DAI: amount.sub(1) } }
      );
    });

    it('user can withdraw all tokens', async () => {
      await expectBalanceChange(() => vault.connect(user).withdraw(tokens.DAI.address, amount, other.address), tokens, {
        account: other,
        changes: { DAI: amount },
      });
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
