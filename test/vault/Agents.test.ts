import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import * as expectEvent from '../helpers/expectEvent';
import { deploy } from '../../scripts/helpers/deploy';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

describe('Vault - agents', () => {
  let admin: SignerWithAddress;
  let user: SignerWithAddress;
  let agent: SignerWithAddress;
  let universalAgentManager: SignerWithAddress;
  let universalAgent: SignerWithAddress;
  let other: SignerWithAddress;

  let vault: Contract;

  before('setup', async () => {
    [, admin, user, agent, universalAgentManager, universalAgent, other] = await ethers.getSigners();
  });

  beforeEach('deploy vault & tokens', async () => {
    vault = await deploy('Vault', { from: admin, args: [admin.address] });
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
      beforeEach('add user agent', async () => {
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

      it('accounts can remove agents', async () => {
        const receipt = await (await vault.connect(user).removeUserAgent(agent.address)).wait();
        expectEvent.inReceipt(receipt, 'UserAgentRemoved', {
          user: user.address,
          agent: agent.address,
        });

        expect(await vault.isAgentFor(user.address, agent.address)).to.equal(false);
      });
    });
  });

  describe('universal agents', () => {
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

      it('universal agent managers can be queried', async () => {
        expect(await vault.getNumberOfUniversalAgentManagers()).to.equal(1);
        expect(await vault.getUniversalAgentManagers(0, 1)).to.have.members([universalAgentManager.address]);
      });

      it('universal agent managers can add new universal agents', async () => {
        await vault.connect(universalAgentManager).addUniversalAgent(universalAgent.address);

        expect(await vault.getNumberOfUniversalAgents()).to.equal(1);
        expect(await vault.getUniversalAgents(0, 1)).to.have.members([universalAgent.address]);
      });

      it('non-universal agent manager cannot add new universal agents', async () => {
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

        it('removing universal agents as regular agents does nothing', async () => {
          await vault.connect(other).removeUserAgent(universalAgent.address);
          expect(await vault.isAgentFor(other.address, universalAgent.address)).to.equal(true);
        });

        it('universal agent managers can remove universal agents', async () => {
          await vault.connect(universalAgentManager).removeUniversalAgent(universalAgent.address);

          expect(await vault.getNumberOfUniversalAgents()).to.equal(0);
        });

        it('non-universal agent managers cannot revoke universal agents', async () => {
          await expect(vault.connect(other).removeUniversalAgent(universalAgent.address)).to.be.revertedWith(
            'Caller is not a universal agent manager'
          );
        });
      });
    });
  });
});
