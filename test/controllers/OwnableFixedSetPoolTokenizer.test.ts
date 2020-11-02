import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { PairTS } from '../../scripts/helpers/pools';
import { deploy } from '../../scripts/helpers/deploy';

describe('OwnableFixedSetPoolTokenizer', function () {
  let owner: SignerWithAddress;
  let other: SignerWithAddress;

  let vault: Contract;
  let strategy: Contract;
  let tokenizer: Contract;

  before(async function () {
    [, owner, other] = await ethers.getSigners();
  });

  beforeEach(async function () {
    vault = await deploy('Vault');
    strategy = await deploy('MockTradingStrategy');

    // TODO: have deploy accept a signer
    tokenizer = await deploy('OwnableFixedSetPoolTokenizer', vault.address, strategy.address, PairTS);
    tokenizer.transferOwnership(owner.address);
  });

  it('has control of the created pool', async function () {
    const poolId = await tokenizer.poolId();
    expect(await vault.getPoolController(poolId)).to.equal(tokenizer.address);
  });

  describe('transferPoolControl', () => {
    it('owner can transfer control of the pool', async () => {
      await tokenizer.connect(owner).transferPoolControl(other.address);

      const poolId = await tokenizer.poolId();
      expect(await vault.getPoolController(poolId)).to.equal(other.address);
    });

    it('non-owner cannot transfer control of the pool', async () => {
      await expect(tokenizer.connect(other).transferPoolControl(other.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      );
    });
  });

  describe('changePoolStrategy', () => {
    it('owner can change the pool trading stategy');
    it('non-owner cannot change the pool trading stategy');
    it('owner cannot change the pool trading stategy to a different type');
  });
});
