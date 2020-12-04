import { ethers, deployments } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from 'hardhat-deploy-ethers/dist/src/signer-with-address';
import { PairTS } from '../../scripts/helpers/pools';
import { deployTokens, TokenList } from '../helpers/tokens';
import { MAX_UINT256 } from '../helpers/constants';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { setupController } from '../../scripts/helpers/controllers';
import { toFixedPoint } from '../../scripts/helpers/fixedPoint';

describe('FixedSetPoolTokenizer', function () {
  let admin: SignerWithAddress;
  let lp: SignerWithAddress;
  let other: SignerWithAddress;
  let beneficiary: SignerWithAddress;

  let vault: Contract;
  let strategy: Contract;
  let tokens: TokenList = {};

  const initialBPT = (100e18).toString();
  let callSetupController: () => Promise<Contract>;

  before(async function () {
    [admin, lp, other, beneficiary] = await ethers.getSigners();
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

        await tokens[token].connect(admin).mint(other.address, (100e18).toString());
        await tokens[token].connect(other).approve(vault.address, MAX_UINT256);
      })
    );

    callSetupController = () =>
      setupController(
        vault,
        admin,
        lp,
        'FixedSetPoolTokenizer',
        strategy.address,
        PairTS,
        initialBPT,
        [tokens.DAI.address, tokens.MKR.address],
        [(1e18).toString(), (2e18).toString()]
      );
  });

  describe('creation via factory', async () => {
    it('creates a pool in the vault', async () => {
      const tokenizer = await callSetupController();

      const poolId = await tokenizer.poolId();
      expect(await vault.getPoolController(poolId)).to.equal(tokenizer.address);
      expect(await vault.getPoolStrategy(poolId)).to.have.members([strategy.address, PairTS]);
    });

    it('grants initial BPT to the LP', async () => {
      const tokenizer = await callSetupController();

      expect(await tokenizer.balanceOf(lp.address)).to.equal(initialBPT);
    });

    it('adds tokens to pool', async () => {
      const tokenizer = await callSetupController();
      const poolId = await tokenizer.poolId();

      expect(await vault.getPoolTokens(poolId)).to.have.members([tokens.DAI.address, tokens.MKR.address]);
      expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address, tokens.MKR.address])).to.deep.equal([
        BigNumber.from((1e18).toString()),
        BigNumber.from((2e18).toString()),
      ]);
    });

    it('pulls tokens from the LP', async () => {
      await expectBalanceChange(() => callSetupController(), lp, tokens, {
        DAI: (-1e18).toString(),
        MKR: (-2e18).toString(),
      });
    });
  });

  context('with tokenizer', () => {
    let tokenizer: Contract;
    let poolId: string;

    beforeEach(async () => {
      tokenizer = await callSetupController();
      poolId = await tokenizer.poolId();
    });

    describe('joining', () => {
      it('grants BPT in return', async () => {
        const previousBPT = await tokenizer.balanceOf(lp.address);

        // To get 10% of the current BPT, an LP needs to supply 10% of the current token balance
        await tokenizer
          .connect(lp)
          .joinPool((10e18).toString(), [(0.1e18).toString(), (0.2e18).toString()], true, lp.address);

        const newBPT = await tokenizer.balanceOf(lp.address);
        expect(newBPT.sub(previousBPT)).to.equal((10e18).toString());
      });

      it('grants BPT to specified beneficiary', async () => {
        const previousBPT = await tokenizer.balanceOf(other.address);

        // To get 10% of the current BPT, an LP needs to supply 10% of the current token balance
        await tokenizer
          .connect(lp)
          .joinPool((10e18).toString(), [(0.1e18).toString(), (0.2e18).toString()], true, other.address);

        const newBPT = await tokenizer.balanceOf(other.address);
        expect(newBPT.sub(previousBPT)).to.equal((10e18).toString());
      });

      it('fails if maximum amounts are not enough', async () => {
        await expect(
          tokenizer
            .connect(lp)
            .joinPool(
              (10e18).toString(),
              [BigNumber.from((0.1e18).toString()).sub(1), (0.2e18).toString()],
              true,
              lp.address
            )
        ).to.be.revertedWith('ERR_LIMIT_IN');

        await expect(
          tokenizer
            .connect(lp)
            .joinPool(
              (10e18).toString(),
              [(0.1e18).toString(), BigNumber.from((0.2e18).toString()).sub(1)],
              true,
              lp.address
            )
        ).to.be.revertedWith('ERR_LIMIT_IN');
      });

      it('only the required tokens are pulled', async () => {
        await expectBalanceChange(
          () =>
            tokenizer
              .connect(lp)
              .joinPool((10e18).toString(), [(10e18).toString(), (10e18).toString()], true, lp.address),
          lp,
          tokens,
          { DAI: -0.1e18, MKR: -0.2e18 }
        );
      });

      it('anybody can join the pool', async () => {
        await tokenizer
          .connect(other)
          .joinPool((10e18).toString(), [(0.1e18).toString(), (0.2e18).toString()], true, other.address);

        expect(await tokenizer.balanceOf(other.address)).to.equal((10e18).toString());
      });

      it('fails if not supplying all tokens', async () => {
        await expect(
          tokenizer.connect(lp).joinPool((10e18).toString(), [(0.1e18).toString()], [(0.1e18).toString()], lp.address)
        ).to.be.revertedWith('Tokens and amounts length mismatch');
      });

      it('fails if supplying extra tokens', async () => {
        await expect(
          tokenizer
            .connect(lp)
            .joinPool(
              (10e18).toString(),
              [(0.1e18).toString(), (0.2e18).toString(), (0.3e18).toString()],
              true,
              lp.address
            )
        ).to.be.revertedWith('Tokens and amounts length mismatch');
      });

      it('can withdraw from user balance', async () => {
        await vault.connect(lp).deposit(tokens.DAI.address, (1e18).toString(), lp.address);
        await vault.connect(lp).deposit(tokens.MKR.address, (1e18).toString(), lp.address);

        await expectBalanceChange(
          () =>
            tokenizer
              .connect(lp)
              .joinPool((10e18).toString(), [(0.1e18).toString(), (0.2e18).toString()], false, lp.address),
          lp,
          tokens,
          {}
        );

        expect(await vault.getUserTokenBalance(lp.address, tokens.DAI.address)).to.equal((0.9e18).toString());
        expect(await vault.getUserTokenBalance(lp.address, tokens.MKR.address)).to.equal((0.8e18).toString());
      });

      it('fails if withdrawing from user balance with insufficient balance', async () => {
        await vault.connect(lp).deposit(tokens.DAI.address, BigNumber.from((0.1e18).toString()).sub(1), lp.address);
        await vault.connect(lp).deposit(tokens.MKR.address, (0.2e18).toString(), lp.address);

        await expect(
          tokenizer
            .connect(lp)
            .joinPool((10e18).toString(), [(0.1e18).toString(), (0.2e18).toString()], false, lp.address)
        ).to.be.revertedWith('ERR_SUB_UNDERFLOW');
      });
    });

    describe('exiting', () => {
      it('takes BPT in return', async () => {
        const previousBPT = await tokenizer.balanceOf(lp.address);

        // By returning 10% of the current BPT, an LP gets in return 10% of the current token balance
        await tokenizer.connect(lp).exitPool((10e18).toString(), [0, 0], true, lp.address);

        const newBPT = await tokenizer.balanceOf(lp.address);
        expect(newBPT.sub(previousBPT)).to.equal((-10e18).toString());
      });

      it('fails if minimum amounts are not enough', async () => {
        await expect(
          tokenizer
            .connect(lp)
            .exitPool(
              (10e18).toString(),
              [BigNumber.from((0.1e18).toString()).add(1), (0.2e18).toString()],
              true,
              lp.address
            )
        ).to.be.revertedWith('NOT EXITING ENOUGH');

        await expect(
          tokenizer
            .connect(lp)
            .exitPool(
              (10e18).toString(),
              [(0.1e18).toString(), BigNumber.from((0.2e18).toString()).add(1)],
              true,
              lp.address
            )
        ).to.be.revertedWith('NOT EXITING ENOUGH');
      });

      it('fails if not requesting all tokens', async () => {
        await expect(
          tokenizer.connect(lp).exitPool((10e18).toString(), [(0.1e18).toString()], true, lp.address)
        ).to.be.revertedWith('Tokens and amounts length mismatch');
      });

      it('all tokens due are pushed', async () => {
        await expectBalanceChange(
          () => tokenizer.connect(lp).exitPool((10e18).toString(), [0, 0], true, lp.address),
          lp,
          tokens,
          {
            DAI: 0.1e18,
            MKR: 0.2e18,
          }
        );
      });

      it('all tokens due are pushed to a specified beneficiary', async () => {
        await expectBalanceChange(
          () => tokenizer.connect(lp).exitPool((10e18).toString(), [0, 0], true, beneficiary.address),
          beneficiary,
          tokens,
          {
            DAI: 0.1e18,
            MKR: 0.2e18,
          }
        );
      });

      context('with protocol withdraw fees', () => {
        const protocolWithdrawFee = 0.01;

        beforeEach(async () => {
          await vault.connect(admin).setProtocolWithdrawFee(toFixedPoint(protocolWithdrawFee));
        });

        it('tokens minus fee are pushed', async () => {
          await expectBalanceChange(
            () => tokenizer.connect(lp).exitPool((10e18).toString(), [0, 0], true, lp.address),
            lp,
            tokens,
            {
              DAI: 0.1e18 * (1 - protocolWithdrawFee),
              MKR: 0.2e18 * (1 - protocolWithdrawFee),
            }
          );
        });
      });

      it('can deposit into user balance', async () => {
        await expectBalanceChange(
          () => tokenizer.connect(lp).exitPool((10e18).toString(), [0, 0], false, lp.address),
          lp,
          tokens,
          {}
        );
      });

      it('fails if requesting extra tokens', async () => {
        await expect(
          tokenizer
            .connect(lp)
            .exitPool(
              (10e18).toString(),
              [(0.1e18).toString(), (0.2e18).toString(), (0.3e18).toString()],
              true,
              lp.address
            )
        ).to.be.revertedWith('Tokens and amounts length mismatch');
      });

      it('can deposit into user balance', async () => {
        await expectBalanceChange(
          () => tokenizer.connect(lp).exitPool((10e18).toString(), [0, 0], false, lp.address),
          lp,
          tokens,
          {}
        );

        expect(await vault.getUserTokenBalance(lp.address, tokens.DAI.address)).to.equal((0.1e18).toString());
        expect(await vault.getUserTokenBalance(lp.address, tokens.MKR.address)).to.equal((0.2e18).toString());
      });

      it("can deposit into a beneficiary's user balance", async () => {
        await expectBalanceChange(
          () => tokenizer.connect(lp).exitPool((10e18).toString(), [0, 0], false, beneficiary.address),
          beneficiary,
          tokens,
          {}
        );

        expect(await vault.getUserTokenBalance(beneficiary.address, tokens.DAI.address)).to.equal((0.1e18).toString());
        expect(await vault.getUserTokenBalance(beneficiary.address, tokens.MKR.address)).to.equal((0.2e18).toString());
      });
    });

    describe('draining', () => {
      it('pools can be fully exited', async () => {
        await tokenizer.connect(lp).exitPool((100e18).toString(), [0, 0], true, lp.address);

        expect(await tokenizer.totalSupply()).to.equal(0);
        expect(await vault.getPoolTokens(poolId)).to.have.members([]);
      });

      it('drained pools cannot be rejoined', async () => {
        await tokenizer.connect(lp).exitPool((100e18).toString(), [0, 0], true, lp.address);
        await expect(
          tokenizer
            .connect(lp)
            .joinPool((10e18).toString(), [(0.1e18).toString(), (0.2e18).toString()], true, lp.address)
        ).to.be.revertedWith('ERR_DIV_ZERO');
      });
    });
  });
});
