import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList from '../helpers/models/tokens/TokenList';
import { expectBalanceChange } from '../helpers/tokenBalance';

import { bn, fp } from '../../lib/helpers/numbers';
import { roleId } from '../../lib/helpers/roles';
import Vault from '../helpers/models/vault/Vault';

describe('Vault - protocol fees', () => {
  let admin: SignerWithAddress, user: SignerWithAddress, feeCollector: SignerWithAddress, other: SignerWithAddress;

  let vault: Vault;
  let tokens: TokenList;
  let feesCollector: Contract;

  before('setup', async () => {
    [, admin, user, feeCollector, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault', async () => {
    vault = await Vault.create({ admin });
    feesCollector = await vault.getFeesCollector();
  });

  sharedBeforeEach('mint tokens', async () => {
    tokens = await TokenList.create(['DAI', 'MKR'], { sorted: true });
    await tokens.mint({ to: user, amount: bn(100e18) });
    await tokens.approve({ to: vault.address, from: user });
  });

  describe('set fees', () => {
    const MAX_SWAP_FEE_PERCENTAGE = bn(50e16); // 50%
    const MAX_FLASH_LOAN_FEE_PERCENTAGE = bn(1e16); // 1%

    context('when the sender is allowed', () => {
      context('when the given input is valid', async () => {
        it('sets the swap fee percentage properly', async () => {
          await vault.setSwapFeePercentage(MAX_SWAP_FEE_PERCENTAGE, { from: admin });

          const swapFeePercentage = await vault.getSwapFeePercentage();
          expect(swapFeePercentage).to.equal(MAX_SWAP_FEE_PERCENTAGE);
        });

        it('sets the flash loan fee percentage properly', async () => {
          await vault.setFlashLoanFeePercentage(MAX_FLASH_LOAN_FEE_PERCENTAGE, { from: admin });

          const flashLoanFeePercentage = await vault.getFlashLoanFeePercentage();
          expect(flashLoanFeePercentage).to.equal(MAX_FLASH_LOAN_FEE_PERCENTAGE);
        });
      });

      context('when the given input is valid', async () => {
        it('reverts if the swap fee is above the maximum', async () => {
          const badSwapFeePercentage = MAX_SWAP_FEE_PERCENTAGE.add(1);

          await expect(vault.setSwapFeePercentage(badSwapFeePercentage, { from: admin })).to.be.revertedWith(
            'SWAP_FEE_TOO_HIGH'
          );
        });

        it('reverts if the flash loan fee is above the maximum', async () => {
          const badFlashLoanFeePercentage = MAX_FLASH_LOAN_FEE_PERCENTAGE.add(1);

          await expect(vault.setFlashLoanFeePercentage(badFlashLoanFeePercentage, { from: admin })).to.be.revertedWith(
            'FLASH_LOAN_FEE_TOO_HIGH'
          );
        });
      });
    });

    context('when the sender is not allowed', () => {
      it('reverts', async () => {
        await expect(vault.setSwapFeePercentage(MAX_SWAP_FEE_PERCENTAGE, { from: other })).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
        await expect(vault.setFlashLoanFeePercentage(MAX_SWAP_FEE_PERCENTAGE, { from: other })).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });
  });

  describe('collected fees', () => {
    it('fees are initially zero', async () => {
      expect(await vault.getCollectedFeeAmounts([tokens.DAI.address])).to.be.zeros;
    });

    context('with collected protocol fees', () => {
      sharedBeforeEach('collect some tokens', async () => {
        await tokens.DAI.transfer(feesCollector, fp(0.025), { from: user });
        await tokens.MKR.transfer(feesCollector, fp(0.05), { from: user });
      });

      it('reports collected fee', async () => {
        const collectedFees = await vault.getCollectedFeeAmounts(tokens);
        expect(collectedFees).to.deep.equal([bn(0.025e18), bn(0.05e18)]);
      });

      it('authorized accounts can withdraw protocol fees to any recipient', async () => {
        const role = await roleId(feesCollector, 'withdrawCollectedFees');
        await vault.grantRole(role, feeCollector);

        await expectBalanceChange(
          () =>
            vault.withdrawCollectedFees(tokens.addresses, [bn(0.02e18), bn(0.04e18)], other, {
              from: feeCollector,
            }),
          tokens,
          { account: other, changes: { DAI: bn(0.02e18), MKR: bn(0.04e18) } }
        );

        const collectedFees = await vault.getCollectedFeeAmounts(tokens);
        expect(collectedFees).to.deep.equal([bn(0.005e18), bn(0.01e18)]);
      });

      it('protocol fees cannot be over-withdrawn', async () => {
        const role = await roleId(feesCollector, 'withdrawCollectedFees');
        await vault.grantRole(role, feeCollector);

        await expect(
          vault.withdrawCollectedFees(tokens.DAI.address, bn(0.05e18).add(1), other, { from: feeCollector })
        ).to.be.revertedWith('ERC20_TRANSFER_EXCEEDS_BALANCE');
      });

      it('unauthorized accounts cannot withdraw collected fees', async () => {
        await expect(vault.withdrawCollectedFees(tokens.DAI.address, 0, other, { from: other })).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });
  });
});
