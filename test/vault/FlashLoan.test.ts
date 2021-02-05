import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '../../lib/helpers/deploy';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { bn, divCeil, fp, FP_SCALING_FACTOR } from '../../lib/helpers/numbers';
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
    await authorizer.connect(admin).grantRole(await authorizer.SET_PROTOCOL_FEES_ROLE(), feeSetter.address);
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
      await vault.connect(feeSetter).setProtocolFees(0, 0, 0);
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
      ).to.be.revertedWith('INSUFFICIENT_BALANCE');
    });

    it('reverts if the borrower does not repay the loan', async () => {
      await receiver.setRepayLoan(false);

      await expect(
        vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [bn(1e18)], '0x10')
      ).to.be.revertedWith('INVALID_POST_LOAN_BALANCE');
    });
  });

  context('with protocol fees', () => {
    const feePercentage = fp(0.005); // 0.5%

    beforeEach(async () => {
      await vault.connect(feeSetter).setProtocolFees(0, 0, feePercentage);
    });

    it('zero loans are possible', async () => {
      const loan = 0;
      const feeAmount = 0;

      await expectBalanceChange(
        () => vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [loan], '0x10'),
        tokens,
        { account: vault }
      );

      expect((await vault.getCollectedFees([tokens.DAI.address]))[0]).to.equal(feeAmount);
    });

    it('the Vault receives protocol fees', async () => {
      const loan = bn(1e18);
      const feeAmount = divCeil(loan.mul(feePercentage), FP_SCALING_FACTOR);

      await expectBalanceChange(
        () => vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [loan], '0x10'),
        tokens,
        { account: vault, changes: { DAI: feeAmount } }
      );

      expect((await vault.getCollectedFees([tokens.DAI.address]))[0]).to.equal(feeAmount);
    });

    it('protocol fees are rounded up', async () => {
      const loan = bn(1);
      const feeAmount = bn(1); // In this extreme case, fees account for the full loan

      await expectBalanceChange(
        () => vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [loan], '0x10'),
        tokens,
        { account: vault, changes: { DAI: feeAmount } }
      );

      expect((await vault.getCollectedFees([tokens.DAI.address]))[0]).to.equal(feeAmount);
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

      expect(await vault.getCollectedFees([tokens.DAI.address])).to.deep.equal([feeAmount]);
    });

    it('all balance can be loaned', async () => {
      await vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [bn(100e18)], '0x10');
    });

    it('reverts if the borrower does not repay the loan', async () => {
      await receiver.setRepayLoan(false);

      await expect(
        vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [bn(1e18)], '0x10')
      ).to.be.revertedWith('INSUFFICIENT_COLLECTED_FEES');
    });

    it('reverts if the borrower reenters the Vault', async () => {
      await receiver.setReenter(true);

      await expect(
        vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [bn(1e18)], '0x10')
      ).to.be.revertedWith('REENTRANCY');
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

        expect(await vault.getCollectedFees([tokens.DAI.address])).to.deep.equal([feeAmounts[0]]);
        expect(await vault.getCollectedFees([tokens.MKR.address])).to.deep.equal([feeAmounts[1]]);
      });

      it('all balance can be loaned', async () => {
        await vault
          .connect(other)
          .flashLoan(receiver.address, [tokens.DAI.address, tokens.MKR.address], [bn(100e18), bn(100e18)], '0x10');
      });
    });
  });
});
