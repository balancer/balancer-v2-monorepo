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
  let agent: SignerWithAddress;
  let universalAgentManager: SignerWithAddress;
  let universalAgent: SignerWithAddress;
  let other: SignerWithAddress;

  let vault: Contract;
  let tokens: TokenList = {};

  before('setup', async () => {
    [, admin, trader, user, agent, universalAgentManager, universalAgent, other] = await ethers.getSigners();
  });

  const amount = BigNumber.from(500);

  describe('deposit & withdraw', () => {
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

  describe('agents', () => {
    it('accounts start with no agents', async () => {
      expect(await vault.getNumberOfUserAgents(user.address)).to.equal(0);
    });

    it('accounts are their own agent', async () => {
      expect(await vault.isAgentFor(user.address, user.address)).to.equal(true);
    });

    it('accounts can add agents', async () => {
      expect(await vault.isAgentFor(user.address, agent.address)).to.equal(false);

      const receipt = await (await vault.connect(user).addUserAgent(agent.address)).wait();
      expectEvent.inReceipt(receipt, 'UserAgentAdded', {
        user: user.address,
        agent: agent.address,
      });

      expect(await vault.isAgentFor(user.address, agent.address)).to.equal(true);
    });

    context('with agents', () => {
      beforeEach('authorize agent', async () => {
        await vault.connect(user).addUserAgent(agent.address);
      });

      it('agents can be listed', async () => {
        const amount = await vault.getNumberOfUserAgents(user.address);
        const agents = await vault.getUserAgents(user.address, 0, amount);

        expect(agents).to.have.members([agent.address]);
      });

      it('new agents can be added to the list', async () => {
        await vault.connect(user).addUserAgent(other.address);

        const amount = await vault.getNumberOfUserAgents(user.address);
        const agents = await vault.getUserAgents(user.address, 0, amount);

        expect(agents).to.have.members([agent.address, other.address]);
      });

      it('accounts can revoke agents', async () => {
        const receipt = await (await vault.connect(user).removeUserAgent(agent.address)).wait();
        expectEvent.inReceipt(receipt, 'UserAgentRemoved', {
          user: user.address,
          agent: agent.address,
        });

        expect(await vault.isAgentFor(user.address, agent.address)).to.equal(false);
      });
    });
  });

  describe('trusted agents', () => {
    it('the vault starts with no universal agents', async () => {
      expect(await vault.getNumberOfUniversalAgents()).to.equal(0);
    });

    it('the vault starts with no universal agent managers', async () => {
      expect(await vault.getNumberOfUniversalAgentManagers()).to.equal(0);
    });

    context('with universal agent manager', () => {
      beforeEach(async () => {
        await vault.connect(admin).addUniversalAgentManager(universalAgentManager.address);
      });

      it('universalAgentManagers can be queried', async () => {
        expect(await vault.getNumberOfUniversalAgentManagers()).to.equal(1);
        expect(await vault.getUniversalAgentManagers(0, 1)).to.have.members([universalAgentManager.address]);
      });

      it('universalAgentManager can report new universal agents', async () => {
        await vault.connect(universalAgentManager).addUniversalAgent(universalAgent.address);

        expect(await vault.getNumberOfUniversalAgents()).to.equal(1);
        expect(await vault.getUniversalAgents(0, 1)).to.have.members([universalAgent.address]);
      });

      it('non-universalAgentManager cannot report new universal agents', async () => {
        await expect(vault.connect(other).addUniversalAgent(universalAgent.address)).to.be.revertedWith(
          'Caller is not a universal agent manager'
        );
      });

      context('with universal agent', () => {
        beforeEach(async () => {
          await vault.connect(universalAgentManager).addUniversalAgent(universalAgent.address);
        });

        it('universal agents are agents for all accounts', async () => {
          expect(await vault.isAgentFor(other.address, universalAgent.address)).to.equal(true);
        });

        it('revoking universal agents as regular agents does nothing', async () => {
          await vault.connect(other).removeUserAgent(universalAgent.address);
          expect(await vault.isAgentFor(other.address, universalAgent.address)).to.equal(true);
        });

        it('universalAgentManager can revoke universal agents', async () => {
          await vault.connect(universalAgentManager).removeUniversalAgent(universalAgent.address);

          expect(await vault.getNumberOfUniversalAgents()).to.equal(0);
        });

        it('non-universalAgentManager cannot revoke universal agents', async () => {
          await expect(vault.connect(other).removeUniversalAgent(universalAgent.address)).to.be.revertedWith(
            'Caller is not a universal agent manager'
          );
        });
      });
    });
  });
});
