import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { Contract } from 'ethers';
import { expect } from 'chai';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';

describe('BALTokenHolderFactory', function () {
  let tokens: TokenList;
  let BAL: Token;
  let vault: Vault;
  let factory: Contract;

  sharedBeforeEach(async () => {
    // Deploy Balancer Vault
    vault = await Vault.create();

    // Deploy BAL token
    tokens = await TokenList.create([{ symbol: 'BAL' }]);
    BAL = await tokens.findBySymbol('BAL');

    factory = await deploy('BALTokenHolderFactory', { args: [BAL.address, vault.address] });
  });

  it('returns the BAL address', async () => {
    expect(await factory.getBalancerToken()).to.equal(BAL.address);
  });

  it('returns the address of the vault', async () => {
    expect(await factory.getVault()).to.equal(vault.address);
  });

  async function deployHolder(name: string): Promise<Contract> {
    const receipt = await (await factory.create(name)).wait();
    const {
      args: { balTokenHolder: holder },
    } = expectEvent.inReceipt(receipt, 'BALTokenHolderCreated', { name });

    return await deployedAt('BALTokenHolder', holder);
  }

  describe('creation', () => {
    it('emits an event', async () => {
      const receipt = await (await factory.create('holder')).wait();
      expectEvent.inReceipt(receipt, 'BALTokenHolderCreated', { name: 'holder' });
    });

    it('creates a holder with the same BAL and vault addresses', async () => {
      const holder = await deployHolder('holder');

      expect(await holder.getBalancerToken()).to.equal(BAL.address);
      expect(await holder.getVault()).to.equal(vault.address);
    });

    it('creates a holder with name', async () => {
      const holder = await deployHolder('holder');
      expect(await holder.getName()).to.equal('holder');
    });

    it('creates holders with unique action IDs', async () => {
      const first = await deployHolder('first');
      const second = await deployHolder('second');

      expect(await actionId(first, 'withdrawFunds')).to.not.equal(await actionId(second, 'withdrawFunds'));
    });
  });

  describe('is holder from factory', () => {
    it('returns true for holders created by the factory', async () => {
      const holder = await deployHolder('holder');
      expect(await factory.isHolderFromFactory(holder.address)).to.equal(true);
    });

    it('returns false for other addresses', async () => {
      expect(await factory.isHolderFromFactory(factory.address)).to.equal(false);
    });
  });
});
