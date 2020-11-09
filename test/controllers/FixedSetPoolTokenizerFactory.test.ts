import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import * as expectEvent from '../helpers/expectEvent';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy } from '../../scripts/helpers/deploy';
import { PairTS } from '../../scripts/helpers/pools';
import { deployTokens, TokenList } from '../helpers/tokens';
import { MAX_UINT256 } from '../helpers/constants';

describe('FixedSetPoolTokenizerFactory', function () {
  let admin: SignerWithAddress;
  let lp: SignerWithAddress;

  let vault: Contract;
  let strategy: Contract;
  let factory: Contract;
  let tokens: TokenList = {};

  const salt = ethers.utils.id('salt');

  const initialBPT = (1e18).toString();
  let poolTokens: Array<string>;
  const poolAmounts = [(1e18).toString(), (1e18).toString()];

  before(async function () {
    [, admin, lp] = await ethers.getSigners();
  });

  beforeEach(async function () {
    vault = await deploy('Vault', { from: admin, args: [] });

    tokens = await deployTokens(['DAI', 'MKR']);
    await Promise.all(
      ['DAI', 'MKR'].map(async (token) => {
        await tokens[token].mint(lp.address, (100e18).toString());
        await tokens[token].connect(lp).approve(vault.address, MAX_UINT256);
      })
    );

    poolTokens = [tokens.DAI.address, tokens.MKR.address];

    strategy = await deploy('MockTradingStrategy', { args: [] });
    factory = await deploy('FixedSetPoolTokenizerFactory', { args: [vault.address] });
  });

  it('fails if not trusted by the vault', async () => {
    await expect(
      factory.connect(lp).create(strategy.address, PairTS, initialBPT, poolTokens, poolAmounts, salt)
    ).to.be.revertedWith('Caller is not trusted operator reporter');
  });

  context('once trusted by the vault', () => {
    beforeEach(async () => {
      await vault.connect(admin).authorizeTrustedOperatorReporter(factory.address);
    });

    it('creates a pool tokenizer', async () => {
      const receipt = await (
        await factory.connect(lp).create(strategy.address, PairTS, initialBPT, poolTokens, poolAmounts, salt)
      ).wait();
      expectEvent.inReceipt(receipt, 'TokenizerCreated');
    });

    it('salt cannot be reused', async () => {
      await factory.connect(lp).create(strategy.address, PairTS, initialBPT, poolTokens, poolAmounts, salt);
      await expect(factory.create(strategy.address, PairTS, salt)).to.be.reverted;
    });

    context('with tokenizer', () => {
      let tokenizer: Contract;

      beforeEach(async () => {
        const receipt = await (
          await factory.connect(lp).create(strategy.address, PairTS, initialBPT, poolTokens, poolAmounts, salt)
        ).wait();
        const event = expectEvent.inReceipt(receipt, 'TokenizerCreated');

        tokenizer = await ethers.getContractAt('FixedSetPoolTokenizer', event.args.tokenizer);
      });

      it('tokenizer is a trusted operator', async () => {
        expect(await vault.getTotalTrustedOperators()).to.equal(1);
        expect(await vault.getTrustedOperators(0, 1)).to.have.members([tokenizer.address]);
      });
    });
  });
});
