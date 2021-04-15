import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList from '../helpers/models/tokens/TokenList';

import { deploy } from '../../lib/helpers/deploy';
import { roleId } from '../../lib/helpers/roles';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { bn, divCeil, fp, FP_SCALING_FACTOR } from '../../lib/helpers/numbers';
import TokensDeployer from '../helpers/models/tokens/TokensDeployer';
import { ZERO_ADDRESS } from '../../lib/helpers/constants';

describe('Vault - flash loans', () => {
  let admin: SignerWithAddress, minter: SignerWithAddress, feeSetter: SignerWithAddress, other: SignerWithAddress;
  let authorizer: Contract, vault: Contract, receiver: Contract, feesCollector: Contract;
  let tokens: TokenList;

  before('setup', async () => {
    [, admin, minter, feeSetter, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault & tokens', async () => {
    const WETH = await TokensDeployer.deployToken({ symbol: 'WETH' });

    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address, WETH.address, 0, 0] });
    receiver = await deploy('MockFlashLoanReceiver', { from: other, args: [vault.address] });
    feesCollector = await ethers.getContractAt('ProtocolFeesCollector', await vault.getProtocolFeesCollector());

    const SET_FLASH_LOAN_ROLE = await roleId(feesCollector, 'setFlashLoanFeePercentage');
    await authorizer.connect(admin).grantRole(SET_FLASH_LOAN_ROLE, feeSetter.address);

    tokens = await TokenList.create(['DAI', 'MKR'], { from: minter, sorted: true });
    await tokens.mint({ to: vault, amount: bn(100e18) });

    // The receiver will mint the fees it
    const MINTER_ROLE = ethers.utils.id('MINTER_ROLE');
    await tokens.asyncEach((token) => token.instance.connect(minter).grantRole(MINTER_ROLE, receiver.address));
  });

  context('with no protocol fees', () => {
    sharedBeforeEach(async () => {
      await feesCollector.connect(feeSetter).setFlashLoanFeePercentage(0);
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
      ).to.be.revertedWith('ERC20_TRANSFER_EXCEEDS_BALANCE');
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

    sharedBeforeEach(async () => {
      await feesCollector.connect(feeSetter).setFlashLoanFeePercentage(feePercentage);
    });

    it('zero loans are possible', async () => {
      const loan = 0;
      const feeAmount = 0;

      await expectBalanceChange(
        () => vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [loan], '0x10'),
        tokens,
        { account: vault }
      );

      expect((await feesCollector.getCollectedFeeAmounts([tokens.DAI.address]))[0]).to.equal(feeAmount);
    });

    it('zero loans are possible', async () => {
      const loan = 0;
      const feeAmount = 0;

      await expectBalanceChange(
        () => vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [loan], '0x10'),
        tokens,
        { account: vault }
      );

      expect((await feesCollector.getCollectedFeeAmounts([tokens.DAI.address]))[0]).to.equal(feeAmount);
    });

    it('the fees module receives protocol fees', async () => {
      const loan = bn(1e18);
      const feeAmount = divCeil(loan.mul(feePercentage), FP_SCALING_FACTOR);

      await expectBalanceChange(
        () => vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [loan], '0x10'),
        tokens,
        { account: feesCollector, changes: { DAI: feeAmount } }
      );

      expect((await feesCollector.getCollectedFeeAmounts([tokens.DAI.address]))[0]).to.equal(feeAmount);
    });

    it('protocol fees are rounded up', async () => {
      const loan = bn(1);
      const feeAmount = bn(1); // In this extreme case, fees account for the full loan

      await expectBalanceChange(
        () => vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [loan], '0x10'),
        tokens,
        { account: feesCollector, changes: { DAI: feeAmount } }
      );

      expect((await feesCollector.getCollectedFeeAmounts([tokens.DAI.address]))[0]).to.equal(feeAmount);
    });

    it('excess fees can be paid', async () => {
      await receiver.setRepayInExcess(true);

      // The receiver pays one extra token
      const feeAmount = bn(1e18).mul(feePercentage).div(FP_SCALING_FACTOR).add(1);

      await expectBalanceChange(
        () => vault.connect(other).flashLoan(receiver.address, [tokens.DAI.address], [bn(1e18)], '0x10'),
        tokens,
        { account: feesCollector, changes: { DAI: feeAmount } }
      );

      expect(await feesCollector.getCollectedFeeAmounts([tokens.DAI.address])).to.deep.equal([feeAmount]);
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
          { account: feesCollector, changes: { DAI: feeAmounts[0], MKR: feeAmounts[1] } }
        );

        expect(await feesCollector.getCollectedFeeAmounts([tokens.DAI.address])).to.deep.equal([feeAmounts[0]]);
        expect(await feesCollector.getCollectedFeeAmounts([tokens.MKR.address])).to.deep.equal([feeAmounts[1]]);
      });

      it('all balance can be loaned', async () => {
        await vault
          .connect(other)
          .flashLoan(receiver.address, [tokens.DAI.address, tokens.MKR.address], [bn(100e18), bn(100e18)], '0x10');
      });

      it('reverts if tokens are not unique', async () => {
        await expect(
          vault
            .connect(other)
            .flashLoan(receiver.address, [tokens.DAI.address, tokens.DAI.address], [bn(100e18), bn(100e18)], '0x10')
        ).to.be.revertedWith('UNSORTED_TOKENS');
      });

      it('reverts if tokens are not sorted', async () => {
        await expect(
          vault
            .connect(other)
            .flashLoan(receiver.address, [tokens.MKR.address, tokens.DAI.address], [bn(100e18), bn(100e18)], '0x10')
        ).to.be.revertedWith('UNSORTED_TOKENS');
      });

      it('reverts if a token is invalid', async () => {
        await expect(
          vault
            .connect(other)
            .flashLoan(receiver.address, [tokens.MKR.address, ZERO_ADDRESS], [bn(100e18), bn(100e18)], '0x10')
        ).to.be.revertedWith('ZERO_TOKEN');
      });
    });
  });
});
