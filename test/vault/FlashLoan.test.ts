import { ethers, deployments } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { TokenList, deployTokens } from '../helpers/tokens';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { FIXED_POINT_SCALING, toFixedPoint } from '../../scripts/helpers/fixedPoint';
import { expectBalanceChange } from '../helpers/tokenBalance';

describe('Vault - flash loans', () => {
  let admin: SignerWithAddress;
  let minter: SignerWithAddress;
  let other: SignerWithAddress;

  let vault: Contract;
  let receiver: Contract;
  let tokens: TokenList = {};

  before('setup', async () => {
    [admin, minter, other] = await ethers.getSigners();
  });

  beforeEach('deploy vault & tokens', async () => {
    await deployments.fixture();
    vault = await ethers.getContract('Vault');
    receiver = await ethers.getContract('MockFlashLoanReceiver');
    tokens = await deployTokens(minter.address, ['DAI', 'MKR'], [18, 18]);

    for (const symbol in tokens) {
      // Grant token balance to the Vault - typically this would happen by the pool controllers adding liquidity
      await tokens[symbol].connect(minter).mint(vault.address, (100e18).toString());

      // The receiver will mint the fees it
      await tokens[symbol].connect(minter).grantRole(ethers.utils.id('MINTER_ROLE'), receiver.address);
    }
  });

  context('with no protocol fees', () => {
    beforeEach(async () => {
      await vault.connect(admin).setProtocolFlashLoanFee(0);
    });

    it('causes no net balance change on the Vault', async () => {
      await expectBalanceChange(
        () => vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [(1e18).toString()], '0x10'),
        tokens,
        { account: vault }
      );
    });

    it('all balance can be loaned', async () => {
      await vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [(100e18).toString()], '0x10');
    });

    it('reverts if the loan is larger than available balance', async () => {
      await expect(
        vault
          .connect(other)
          .flashLoan(receiver.address, [tokens.DAI.address], [BigNumber.from((100e18).toString()).add(1)], '0x10')
      ).to.be.revertedWith('Insufficient balance to borrow');
    });

    it('reverts if the borrower does not repay the loan', async () => {
      await receiver.setRepayLoan(false);

      await expect(
        vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [(1e18).toString()], '0x10')
      ).to.be.revertedWith('ERR_SUB_UNDERFLOW');
    });
  });

  context('with protocol fees', () => {
    const feePercentage = toFixedPoint(0.005); // 0.5%

    beforeEach(async () => {
      await vault.connect(admin).setProtocolFlashLoanFee(feePercentage);
    });

    it('the Vault receives protocol fees', async () => {
      const feeAmount = BigNumber.from((1e18).toString()).mul(feePercentage).div(FIXED_POINT_SCALING);

      await expectBalanceChange(
        () => vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [(1e18).toString()], '0x10'),
        tokens,
        { account: vault, changes: { DAI: feeAmount } }
      );

      expect(await vault.getCollectedFeesByToken(tokens.DAI.address)).to.equal(feeAmount);
    });

    it('excess fees can be paid', async () => {
      await receiver.setRepayInExcess(true);

      // The receiver pays one extra token
      const feeAmount = BigNumber.from((1e18).toString()).mul(feePercentage).div(FIXED_POINT_SCALING).add(1);

      await expectBalanceChange(
        () => vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [(1e18).toString()], '0x10'),
        tokens,
        { account: vault.address, changes: { DAI: feeAmount } }
      );

      expect(await vault.getCollectedFeesByToken(tokens.DAI.address)).to.equal(feeAmount);
    });

    it('all balance can be loaned', async () => {
      await vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [(100e18).toString()], '0x10');
    });

    it('reverts if the borrower does not repay the loan', async () => {
      await receiver.setRepayLoan(false);

      await expect(
        vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [(1e18).toString()], '0x10')
      ).to.be.revertedWith('Insufficient protocol fees');
    });

    it('reverts if the borrower reenters the Vault', async () => {
      await receiver.setReenter(true);

      await expect(
        vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [(1e18).toString()], '0x10')
      ).to.be.revertedWith('ReentrancyGuard: reentrant call');
    });

    describe('multi asset loan', () => {
      it('the Vault receives protocol fees proportial to each loan', async () => {
        const amounts = [1e18, 2e18].map((value) => BigNumber.from(value.toString()));
        const feeAmounts = amounts.map((amount) => amount.mul(feePercentage).div(FIXED_POINT_SCALING));

        await expectBalanceChange(
          () =>
            vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address, tokens.MKR.address], amounts, '0x10'),
          tokens,
          { account: vault, changes: { DAI: feeAmounts[0], MKR: feeAmounts[1] } }
        );

        expect(await vault.getCollectedFeesByToken(tokens.DAI.address)).to.equal(feeAmounts[0]);
        expect(await vault.getCollectedFeesByToken(tokens.MKR.address)).to.equal(feeAmounts[1]);
      });

      it('all balance can be loaned', async () => {
        await vault
          .connect(other)
          .flashLoan(
            receiver.address,
            [tokens.DAI.address, tokens.MKR.address],
            [(100e18).toString(), (100e18).toString()],
            '0x10'
          );
      });
    });
  });
});
