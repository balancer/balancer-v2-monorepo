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
    vault = await deploy('Vault', { args: [controller.address] });
    strategy = await deploy('MockTradingStrategy', { args: [] });
    tokens = await deployTokens(['DAI', 'MKR', 'SNX'], [18, 18, 18]);

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

    it('controller can add liquidity', async () => {
      await vault.connect(controller).addLiquidity(poolId, controller.address, [tokens.DAI.address], [5], [5]);
      expect(await vault.getPoolTokens(poolId)).to.deep.equal([tokens.DAI.address]);

      expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address])).to.deep.equal([BigNumber.from(5)]);
    });

    it('controller can add liquidity multiple times', async () => {
      await vault.connect(controller).addLiquidity(poolId, controller.address, [tokens.DAI.address], [5], [5]);
      await vault
        .connect(controller)
        .addLiquidity(poolId, controller.address, [tokens.DAI.address, tokens.MKR.address], [5, 10], [5, 10]);

      expect(await vault.getPoolTokens(poolId)).to.deep.equal([tokens.DAI.address, tokens.MKR.address]);
      expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address, tokens.MKR.address])).to.deep.equal([
        BigNumber.from(10),
        BigNumber.from(10),
      ]);
    });

    it('tokens are pulled from the controller when adding liquidity', async () => {
      await expectBalanceChange(
        () =>
          vault
            .connect(controller)
            .addLiquidity(poolId, controller.address, [tokens.DAI.address, tokens.MKR.address], [5, 10], [5, 10]),
        controller,
        tokens,
        { DAI: -5, MKR: -10 }
      );
    });

    it('controller can add liquidity by withdrawing tokens from user balance', async () => {
      await vault.connect(controller).deposit(tokens.DAI.address, 50, controller.address);
      await vault.connect(controller).deposit(tokens.MKR.address, 100, controller.address);

      await expectBalanceChange(
        () =>
          vault
            .connect(controller)
            .addLiquidity(poolId, controller.address, [tokens.DAI.address, tokens.MKR.address], [5, 10], [0, 0]),
        controller,
        tokens,
        {}
      );

      expect(await vault.getUserTokenBalance(controller.address, tokens.DAI.address)).to.equal(45); // 5 out of 50 taken
      expect(await vault.getUserTokenBalance(controller.address, tokens.MKR.address)).to.equal(90); // 10 out of 100 taken
    });

    it('controller can add liquidity by both transferring and withdrawing tokens from user balance', async () => {
      await vault.connect(controller).deposit(tokens.DAI.address, 50, controller.address);
      await vault.connect(controller).deposit(tokens.MKR.address, 100, controller.address);

      await expectBalanceChange(
        () =>
          vault
            .connect(controller)
            .addLiquidity(poolId, controller.address, [tokens.DAI.address, tokens.MKR.address], [5, 10], [2, 4]),
        controller,
        tokens,
        { DAI: -2, MKR: -4 }
      );

      expect(await vault.getUserTokenBalance(controller.address, tokens.DAI.address)).to.equal(47); // 3 (5 - 2) out of 50 taken
      expect(await vault.getUserTokenBalance(controller.address, tokens.MKR.address)).to.equal(94); // 6 (10 - 4) out of 100 taken
    });

    it('controller cannot add liquidity from insufficient user balance', async () => {
      await vault.connect(controller).deposit(tokens.DAI.address, 50, controller.address);
      await vault.connect(controller).deposit(tokens.MKR.address, 9, controller.address);

      await expect(
        vault
          .connect(controller)
          .addLiquidity(poolId, controller.address, [tokens.DAI.address, tokens.MKR.address], [5, 10], [0, 0])
      ).to.be.revertedWith('ERR_SUB_UNDERFLOW');
    });

    it('non-controller cannot add liquidity', async () => {
      await expect(
        vault.connect(other).addLiquidity(poolId, controller.address, [tokens.DAI.address], [5], [5])
      ).to.be.revertedWith('Caller is not the pool controller');
    });

    context('with added liquidity', () => {
      beforeEach(async () => {
        await vault
          .connect(controller)
          .addLiquidity(poolId, controller.address, [tokens.DAI.address, tokens.MKR.address], [5, 10], [5, 10]);
      });

      it('controller can remove liquidity', async () => {
        await vault.connect(controller).removeLiquidity(poolId, controller.address, [tokens.MKR.address], [10], [10]);

        expect(await vault.getPoolTokens(poolId)).to.deep.equal([tokens.DAI.address]);
        expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address])).to.deep.equal([BigNumber.from(5)]);
      });

      it('controller can partially remove liquidity', async () => {
        await vault.connect(controller).removeLiquidity(poolId, controller.address, [tokens.MKR.address], [3], [3]);

        expect(await vault.getPoolTokens(poolId)).to.deep.equal([tokens.DAI.address, tokens.MKR.address]);
        expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address, tokens.MKR.address])).to.deep.equal([
          BigNumber.from(5),
          BigNumber.from(7),
        ]);
      });

      it('controller can remove liquidity by depositing tokens into user balance', async () => {
        await expectBalanceChange(
          () => vault.connect(controller).removeLiquidity(poolId, controller.address, [tokens.MKR.address], [10], [0]),
          controller,
          tokens,
          {}
        );

        expect(await vault.getUserTokenBalance(controller.address, tokens.MKR.address)).to.equal(10);
      });

      it('controller can remove liquidity by both transferring and depositing tokens into user balance', async () => {
        await expectBalanceChange(
          () => vault.connect(controller).removeLiquidity(poolId, controller.address, [tokens.MKR.address], [10], [3]),
          controller,
          tokens,
          { MKR: 3 }
        );

        expect(await vault.getUserTokenBalance(controller.address, tokens.MKR.address)).to.equal(7); // 10 - 3
      });

      it('tokens are pushed to controller when removing liquidity', async () => {
        await expectBalanceChange(
          () => vault.connect(controller).removeLiquidity(poolId, controller.address, [tokens.MKR.address], [10], [10]),
          controller,
          tokens,
          { MKR: 10 }
        );
      });

      it('controller cannot remove liquidity not in pool', async () => {
        await expect(
          vault.connect(controller).removeLiquidity(poolId, controller.address, [tokens.SNX.address], [0], [0])
        ).to.be.revertedWith('Token not in pool');
      });

      it('non-controller cannot remove liquidity', async () => {
        await expect(
          vault.connect(other).removeLiquidity(poolId, controller.address, [tokens.MKR.address], [0], [0])
        ).to.be.revertedWith('Caller is not the pool controller');
      });
    });
  });
});
