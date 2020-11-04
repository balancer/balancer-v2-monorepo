import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import * as expectEvent from '../helpers/expectEvent';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy } from '../../scripts/helpers/deploy';
import { PairTS } from '../../scripts/helpers/pools';

describe('FixedSetPoolTokenizerFactory', function () {
  let admin: SignerWithAddress;

  let vault: Contract;
  let strategy: Contract;
  let factory: Contract;

  before(async function () {
    [, admin] = await ethers.getSigners();
  });

  beforeEach(async function () {
    vault = await deploy('Vault', { from: admin, args: [] });

    strategy = await deploy('MockTradingStrategy', { args: [] });
    factory = await deploy('FixedSetPoolTokenizerFactory', { args: [vault.address] });
  });

  const salt = ethers.utils.id('salt');

  it('fails if not trusted by the vault', async () => {
    await expect(factory.create(strategy.address, PairTS, salt)).to.be.revertedWith(
      'Caller is not trusted operator reporter'
    );
  });

  context('once trusted by the vault', () => {
    beforeEach(async () => {
      await vault.connect(admin).authorizeTrustedOperatorReporter(factory.address);
    });

    it('creates a pool tokenizer', async () => {
      const receipt = await (await factory.create(strategy.address, PairTS, salt)).wait();
      expectEvent.inReceipt(receipt, 'FixedSetPoolTokenizerCreated');
    });

    it('salt cannot be reused', async () => {
      await factory.create(strategy.address, PairTS, salt);
      await expect(factory.create(strategy.address, PairTS, salt)).to.be.reverted;
    });

    context('with tokenizer', () => {
      let tokenizer: Contract;

      beforeEach(async () => {
        const receipt = await (await factory.create(strategy.address, PairTS, salt)).wait();
        const event = expectEvent.inReceipt(receipt, 'FixedSetPoolTokenizerCreated');

        tokenizer = await ethers.getContractAt('FixedSetPoolTokenizer', event.args.tokenizer);
      });

      it('tokenizer has the correct configuration', async () => {
        expect(await tokenizer.vault()).to.equal(vault.address);

        const poolId = await tokenizer.poolId();
        expect(await vault.getPoolStrategy(poolId)).to.deep.equal([strategy.address, PairTS]);
      });

      it('tokenizer is a trusted operator', async () => {
        expect(await vault.getTotalTrustedOperators()).to.equal(1);
        expect(await vault.getTrustedOperators(0, 1)).to.have.members([tokenizer.address]);
      });
    });
  });
});
