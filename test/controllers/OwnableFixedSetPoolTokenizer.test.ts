import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { PairTS, TupleTS } from '../../scripts/helpers/pools';
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
    vault = await deploy('Vault', { args: [] });
    strategy = await deploy('MockTradingStrategy', { args: [] });

    tokenizer = await deploy('OwnableFixedSetPoolTokenizer', {
      from: owner,
      args: [vault.address, strategy.address, PairTS],
    });
  });

  it('has control of the created pool', async function () {
    const poolId = await tokenizer.poolId();
    expect(await vault.getPoolController(poolId)).to.equal(tokenizer.address);
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

  describe('changePoolStrategy', () => {
    let otherStrategy: Contract;

    beforeEach(async () => {
      otherStrategy = await deploy('MockTradingStrategy', { args: [] });
    });

    it('owner can change the pool trading stategy', async () => {
      await tokenizer.connect(owner).changePoolStrategy(otherStrategy.address, PairTS);

      const poolId = await tokenizer.poolId();
      expect(await vault.getPoolStrategy(poolId)).to.have.members([otherStrategy.address, PairTS]);
    });

    it('non-owner cannot change the pool trading stategy', async () => {
      await expect(tokenizer.connect(other).changePoolStrategy(otherStrategy.address, PairTS)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      );
    });

    it('owner cannot change the pool trading stategy to a different type', async () => {
      await expect(tokenizer.connect(owner).changePoolStrategy(otherStrategy.address, TupleTS)).to.be.revertedWith(
        'Trading strategy type cannot change'
      );
    });
  });
});
