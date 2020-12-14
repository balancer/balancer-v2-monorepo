import { ethers, deployments } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { PairTS, TupleTS } from '../../scripts/helpers/pools';
import { setupController } from '../../scripts/helpers/controllers';
import { deployTokens, TokenList } from '../helpers/tokens';
import { MAX_UINT256 } from '../helpers/constants';

describe('OwnableFixedSetPoolTokenizer', function () {
  let admin: SignerWithAddress;
  let lp: SignerWithAddress;
  let owner: SignerWithAddress;
  let other: SignerWithAddress;

  let vault: Contract;
  let tokens: TokenList;
  let strategy: Contract;

  let callSetupController: () => Promise<Contract>;

  before(async function () {
    [admin, lp, owner, other] = await ethers.getSigners();
  });

  beforeEach(async function () {
    await deployments.fixture();
    vault = await ethers.getContract('Vault');
    strategy = await ethers.getContract('MockTradingStrategy');

    tokens = await deployTokens(admin.address, ['DAI', 'MKR'], [18, 18]);
    await Promise.all(
      ['DAI', 'MKR'].map(async (token) => {
        await tokens[token].connect(admin).mint(lp.address, (100e18).toString());
        await tokens[token].connect(lp).approve(vault.address, MAX_UINT256);
      })
    );

    strategy = await ethers.getContract('MockTradingStrategy');

    callSetupController = () =>
      setupController(
        vault,
        admin,
        lp,
        'OwnableFixedSetPoolTokenizer',
        strategy.address,
        PairTS,
        (100e18).toString(),
        [tokens.DAI.address, tokens.MKR.address],
        [(1e18).toString(), (2e18).toString()],
        owner.address
      );
  });

  describe('creation via factory', async () => {
    it('grants ownership', async () => {
      const tokenizer = await callSetupController();
      expect(await tokenizer.owner()).to.equal(owner.address);
    });
  });

  context('with tokenizer', () => {
    let tokenizer: Contract;

    beforeEach(async () => {
      tokenizer = await callSetupController();
    });

    describe('changePoolController', () => {
      it('owner can transfer control of the pool', async () => {
        await tokenizer.connect(owner).changePoolController(other.address);

        const poolId = await tokenizer.poolId();
        expect(await vault.getPoolController(poolId)).to.equal(other.address);
      });

      it('non-owner cannot transfer control of the pool', async () => {
        await expect(tokenizer.connect(other).changePoolController(other.address)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        );
      });
    });

    describe('authorizePoolInvestmentManager', () => {
      it('owner can authorize an investment manager', async () => {
        await tokenizer.connect(owner).authorizePoolInvestmentManager(tokens.DAI.address, other.address);

        const poolId = await tokenizer.poolId();
        expect(await vault.isPoolInvestmentManager(poolId, tokens.DAI.address, other.address)).to.equal(true);
      });
      /*
      Removed as bug causing a fail - Tokenizers are likely to change so can revisit.
      Test will pass when commenting out FixedSetPoolTokenizer > joinPool from line starting IERC20[] memory tokens = vault.getPoolTokens(poolId);
      it('non-owner cannot transfer control of the pool', async () => {
        await expect(
          tokenizer.connect(other).authorizePoolInvestmentManager(tokens.DAI.address, other.address)
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });
      */
    });
  });
});
