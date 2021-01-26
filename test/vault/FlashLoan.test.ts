import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '../../lib/helpers/deploy';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { bn, fp, FP_SCALING_FACTOR } from '../../lib/helpers/numbers';
import { TokenList, deployTokens } from '../../lib/helpers/tokens';

describe('Vault - flash loans', () => {
  let admin: SignerWithAddress;
  let minter: SignerWithAddress;
  let feeSetter: SignerWithAddress;
  let other: SignerWithAddress;

  let authorizer: Contract;
  let vault: Contract;
  let receiver: Contract;
  let tokens: TokenList = {};

  before('setup', async () => {
    [, admin, minter, feeSetter, other] = await ethers.getSigners();
  });

  beforeEach('deploy vault & tokens', async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    await authorizer.connect(admin).grantRole(await authorizer.SET_PROTOCOL_FLASH_LOAN_FEE_ROLE(), feeSetter.address);
    vault = await deploy('Vault', { args: [authorizer.address] });

    receiver = await deploy('MockFlashLoanReceiver', { from: other, args: [vault.address] });

    tokens = await deployTokens(['DAI', 'MKR'], [18, 18], minter);

    for (const symbol in tokens) {
      // Grant token balance to the Vault - typically this would happen by the pool controllers adding liquidity
      await tokens[symbol].connect(minter).mint(vault.address, bn(100e18));

      // The receiver will mint the fees it
      await tokens[symbol].connect(minter).grantRole(ethers.utils.id('MINTER_ROLE'), receiver.address);
    }
  });

  context('with no protocol fees', () => {
    beforeEach(async () => {
      await vault.connect(feeSetter).setProtocolFlashLoanFee(0);
    });

    it('causes no net balance change on the Vault', async () => {
      await expectBalanceChange(
        () => vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [bn(1e18)], '0x10'),
        tokens,
        { account: vault }
      );
    });

    it('all balance can be loaned', async () => {
      await vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [bn(100e18)], '0x10');
    });

    it('reverts if the loan is larger than available balance', async () => {
      await expect(
        vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [bn(100e18).add(1)], '0x10')
      ).to.be.revertedWith('Insufficient balance to borrow');
    });

    it('reverts if the borrower does not repay the loan', async () => {
      await receiver.setRepayLoan(false);

      await expect(
        vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [bn(1e18)], '0x10')
      ).to.be.revertedWith('ERR_SUB_UNDERFLOW');
    });
  });

  context('with protocol fees', () => {
    const feePercentage = fp(0.005); // 0.5%

    beforeEach(async () => {
      await vault.connect(feeSetter).setProtocolFlashLoanFee(feePercentage);
    });

    it('the Vault receives protocol fees', async () => {
      const feeAmount = bn(1e18).mul(feePercentage).div(FP_SCALING_FACTOR);

      await expectBalanceChange(
        () => vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [bn(1e18)], '0x10'),
        tokens,
        { account: vault, changes: { DAI: feeAmount } }
      );

      expect(await vault.getCollectedFeesByToken(tokens.DAI.address)).to.equal(feeAmount);
    });

    it('excess fees can be paid', async () => {
      await receiver.setRepayInExcess(true);

      // The receiver pays one extra token
      const feeAmount = bn(1e18).mul(feePercentage).div(FP_SCALING_FACTOR).add(1);

      await expectBalanceChange(
        () => vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [bn(1e18)], '0x10'),
        tokens,
        { account: vault.address, changes: { DAI: feeAmount } }
      );

      expect(await vault.getCollectedFeesByToken(tokens.DAI.address)).to.equal(feeAmount);
    });

    it('all balance can be loaned', async () => {
      await vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [bn(100e18)], '0x10');
    });

    it('reverts if the borrower does not repay the loan', async () => {
      await receiver.setRepayLoan(false);

      await expect(
        vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [bn(1e18)], '0x10')
      ).to.be.revertedWith('Insufficient protocol fees');
    });

    it('reverts if the borrower reenters the Vault', async () => {
      await receiver.setReenter(true);

      await expect(
        vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [bn(1e18)], '0x10')
      ).to.be.revertedWith('ReentrancyGuard: reentrant call');
    });

    describe('multi asset loan', () => {
      it('the Vault receives protocol fees proportial to each loan', async () => {
        const amounts = [1e18, 2e18].map(bn);
        const feeAmounts = amounts.map((amount) => amount.mul(feePercentage).div(FP_SCALING_FACTOR));

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
          .flashLoan(receiver.address, [tokens.DAI.address, tokens.MKR.address], [bn(100e18), bn(100e18)], '0x10');
      });
    });
  });
});
