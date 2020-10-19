import { ethers } from '@nomiclabs/buidler';
import { expect } from 'chai';
import { Contract, Signer } from 'ethers';
import * as expectEvent from '../helpers/expectEvent';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { TokenList, deployTokens, mintTokens } from '../helpers/tokens';
import { deploy } from '../../scripts/helpers/deploy';

describe('Vault - user balance', () => {
  let trader: Signer;
  let creditor: Signer;
  let other: Signer;

  let vault: Contract;
  let tokens: TokenList = {};

  before('setup', async () => {
    [, trader, creditor, other] = await ethers.getSigners();
  });

  const amount = ethers.BigNumber.from(500);

  beforeEach('deploy vault & tokens', async () => {
    vault = await deploy('Vault');
    tokens = await deployTokens(['DAI', 'MKR']);

    await mintTokens(tokens, 'DAI', trader, amount.toString());
  });

  it('user can deposit tokens', async () => {
    await tokens.DAI.connect(trader).approve(vault.address, amount);
    const receipt = await (
      await vault.connect(trader).deposit(tokens.DAI.address, amount, await creditor.getAddress())
    ).wait();

    expectEvent.inReceipt(receipt, 'Deposited', {
      depositor: await trader.getAddress(),
      creditor: await creditor.getAddress(),
      token: tokens.DAI.address,
      amount,
    });
  });

  it('user must approve before depositing tokens', async () => {
    await expect(
      vault.connect(trader).deposit(tokens.DAI.address, amount, await creditor.getAddress())
    ).to.be.revertedWith('ERC20: transfer amount exceeds allowance');
  });

  context('with deposited tokens', () => {
    beforeEach(async () => {
      await tokens.DAI.connect(trader).approve(vault.address, amount);
      await vault.connect(trader).deposit(tokens.DAI.address, amount, await creditor.getAddress());
    });

    it('credit can be queried', async () => {
      expect(await vault.getUserTokenBalance(await creditor.getAddress(), tokens.DAI.address)).to.equal(amount);
    });

    it('tokens are not credited to the account that deposits', async () => {
      expect(await vault.getUserTokenBalance(await trader.getAddress(), tokens.DAI.address)).to.equal(0);
    });

    it('creditor can withdraw tokens to any address', async () => {
      const receipt = await (
        await vault.connect(creditor).withdraw(tokens.DAI.address, amount, await other.getAddress())
      ).wait();

      expectEvent.inReceipt(receipt, 'Withdrawn', {
        creditor: await creditor.getAddress(),
        recipient: await other.getAddress(),
        token: tokens.DAI.address,
        amount,
      });
    });

    it('creditor can withdraw partial tokens', async () => {
      await expectBalanceChange(
        async () => {
          await vault.connect(creditor).withdraw(tokens.DAI.address, amount.sub(1), await other.getAddress());
        },
        other,
        tokens,
        { DAI: amount.sub(1) }
      );
    });

    it('creditor can withdraw all tokens', async () => {
      await expectBalanceChange(
        async () => {
          await vault.connect(creditor).withdraw(tokens.DAI.address, amount, await other.getAddress());
        },
        other,
        tokens,
        { DAI: amount }
      );
    });

    it('withdrawal updates balance', async () => {
      await vault.connect(creditor).withdraw(tokens.DAI.address, amount.sub(1), await other.getAddress());
      expect(await vault.getUserTokenBalance(await creditor.getAddress(), tokens.DAI.address)).to.equal(1);
    });

    it('creditor cannot overwithdraw', async () => {
      await expect(
        vault.connect(creditor).withdraw(tokens.DAI.address, amount.add(1), await other.getAddress())
      ).to.be.revertedWith('Vault: withdraw amount exceeds balance');
    });

    it('depositor cannot withdraw tokens', async () => {
      await expect(
        vault.connect(trader).withdraw(tokens.DAI.address, amount, await other.getAddress())
      ).to.be.revertedWith('Vault: withdraw amount exceeds balance');
    });
  });
});
