import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import * as expectEvent from '../helpers/expectEvent';
import { TokenList, deployTokens, mintTokens } from '../helpers/tokens';
import { deploy } from '../../scripts/helpers/deploy';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { MAX_UINT256, ZERO_ADDRESS } from '../helpers/constants';
import { TupleTS } from '../../scripts/helpers/pools';
import { expectBalanceChange } from '../helpers/tokenBalance';

describe('Vault - pool registry', () => {
  let controller: SignerWithAddress;
  let other: SignerWithAddress;

  let vault: Contract;
  let strategy: Contract;
  let tokens: TokenList = {};

  before('setup', async () => {
    [, controller, other] = await ethers.getSigners();
  });

  const tokenSupply = ethers.BigNumber.from(500);

  beforeEach('deploy vault & tokens', async () => {
    vault = await deploy('Vault', { args: [] });
    strategy = await deploy('MockTradingStrategy', { args: [] });
    tokens = await deployTokens(['DAI', 'MKR', 'SNX']);

    for (const symbol in tokens) {
      await mintTokens(tokens, symbol, controller, tokenSupply.toString());
      await tokens[symbol].connect(controller).approve(vault.address, MAX_UINT256);
    }
  });

  describe('pool creation', () => {
    it('controller can create pools', async () => {
      const receipt = await (await vault.connect(controller).newPool(strategy.address, TupleTS)).wait();

      const event = expectEvent.inReceipt(receipt, 'PoolCreated');
      const poolId = event.args.poolId;

      expect(poolId).to.not.be.undefined;
    });

    it('pools require a non-zero strategy', async () => {
      await expect(vault.connect(controller).newPool(ZERO_ADDRESS, TupleTS)).to.be.revertedWith('Strategy must be set');
    });

    it('pools require a valid strategy type', async () => {
      await expect(vault.connect(controller).newPool(strategy.address, 2)).to.be.reverted;
    });
  });

  describe('pool properties', () => {
    let poolId: string;

    beforeEach(async () => {
      const receipt = await (await vault.connect(controller).newPool(strategy.address, TupleTS)).wait();

      const event = expectEvent.inReceipt(receipt, 'PoolCreated');
      poolId = event.args.poolId;
    });

    it('new pool is added to pool list', async () => {
      expect(await vault.getTotalPools()).to.equal(1);
      expect(await vault.getPoolIds(0, 1)).to.have.members([poolId]);
    });

    it('creator is pool controller', async () => {
      expect(await vault.getPoolController(poolId)).to.equal(controller.address);
    });

    it('strategy is set', async () => {
      expect(await vault.getPoolStrategy(poolId)).to.deep.equal([strategy.address, TupleTS]);
    });

    it('pool starts with no tokens', async () => {
      expect(await vault.getPoolTokens(poolId)).to.have.members([]);
    });

    it('new pool gets a different id', async () => {
      const receipt = await (await vault.connect(controller).newPool(strategy.address, TupleTS)).wait();

      const event = expectEvent.inReceipt(receipt, 'PoolCreated');
      const otherPoolId = event.args.poolId;

      expect(poolId).to.not.equal(otherPoolId);
      expect(await vault.getTotalPools()).to.equal(2);
      expect(await vault.getPoolIds(0, 2)).to.have.members([poolId, otherPoolId]);
    });
  });

  describe('controller privileges', () => {
    let poolId: string;

    beforeEach(async () => {
      const receipt = await (await vault.connect(controller).newPool(strategy.address, TupleTS)).wait();

      const event = expectEvent.inReceipt(receipt, 'PoolCreated');
      poolId = event.args.poolId;
    });

    describe('setController', () => {
      it('controller can set a new controller', async () => {
        await vault.connect(controller).setPoolController(poolId, other.address);

        expect(await vault.getPoolController(poolId)).to.equal(other.address);
      });

      it('non-controller cannot set a new controller', async () => {
        await expect(vault.connect(other).setPoolController(poolId, other.address)).to.be.revertedWith(
          'Caller is not the pool controller'
        );
      });
    });
  });

  describe('token management', () => {
    let poolId: string;

    beforeEach(async () => {
      const receipt = await (await vault.connect(controller).newPool(strategy.address, TupleTS)).wait();

      const event = expectEvent.inReceipt(receipt, 'PoolCreated');
      poolId = event.args.poolId;
    });

    it('controller can add tokens', async () => {
      await vault.connect(controller).addLiquidity(poolId, controller.address, [tokens.DAI.address], [5]);
      expect(await vault.getPoolTokens(poolId)).to.deep.equal([tokens.DAI.address]);

      expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address])).to.deep.equal([BigNumber.from(5)]);
    });

    it('controller can add tokens multiple times', async () => {
      await vault.connect(controller).addLiquidity(poolId, controller.address, [tokens.DAI.address], [5]);
      await vault
        .connect(controller)
        .addLiquidity(poolId, controller.address, [tokens.DAI.address, tokens.MKR.address], [5, 10]);

      expect(await vault.getPoolTokens(poolId)).to.deep.equal([tokens.DAI.address, tokens.MKR.address]);
      expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address, tokens.MKR.address])).to.deep.equal([
        BigNumber.from(10),
        BigNumber.from(10),
      ]);
    });

    it('tokens are pulled from the controller when adding them', async () => {
      await expectBalanceChange(
        () =>
          vault
            .connect(controller)
            .addLiquidity(poolId, controller.address, [tokens.DAI.address, tokens.MKR.address], [5, 10]),
        controller,
        tokens,
        { DAI: -5, MKR: -10 }
      );
    });

    it('non-controller cannot add tokens', async () => {
      await expect(
        vault.connect(other).addLiquidity(poolId, controller.address, [tokens.DAI.address], [5])
      ).to.be.revertedWith('Caller is not the pool controller');
    });

    context('with added tokens', () => {
      beforeEach(async () => {
        await vault
          .connect(controller)
          .addLiquidity(poolId, controller.address, [tokens.DAI.address, tokens.MKR.address], [5, 10]);
      });

      it('controller can remove tokens', async () => {
        await vault.connect(controller).removeLiquidity(poolId, controller.address, [tokens.MKR.address], [10]);

        expect(await vault.getPoolTokens(poolId)).to.deep.equal([tokens.DAI.address]);
        expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address])).to.deep.equal([BigNumber.from(5)]);
      });

      it('controller can partially remove tokens', async () => {
        await vault.connect(controller).removeLiquidity(poolId, controller.address, [tokens.MKR.address], [3]);

        expect(await vault.getPoolTokens(poolId)).to.deep.equal([tokens.DAI.address, tokens.MKR.address]);
        expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address, tokens.MKR.address])).to.deep.equal([
          BigNumber.from(5),
          BigNumber.from(7),
        ]);
      });

      it('tokens are pushed to controller when removing them', async () => {
        await expectBalanceChange(
          () => vault.connect(controller).removeLiquidity(poolId, controller.address, [tokens.MKR.address], [10]),
          controller,
          tokens,
          { MKR: 10 }
        );
      });

      it('controller cannot remove tokens not in pool', async () => {
        await expect(
          vault.connect(controller).removeLiquidity(poolId, controller.address, [tokens.SNX.address], [0])
        ).to.be.revertedWith('Token not in pool');
      });

      it('non-controller cannot remove tokens', async () => {
        await expect(
          vault.connect(other).removeLiquidity(poolId, controller.address, [tokens.MKR.address], [0])
        ).to.be.revertedWith('Caller is not the pool controller');
      });
    });
  });
});
