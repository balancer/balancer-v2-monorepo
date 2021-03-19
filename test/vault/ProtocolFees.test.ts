import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList from '../helpers/models/tokens/TokenList';
import { expectBalanceChange } from '../helpers/tokenBalance';

import { bn } from '../../lib/helpers/numbers';
import { roleId } from '../../lib/helpers/roles';
import { deploy } from '../../lib/helpers/deploy';
import { ZERO_ADDRESS } from '../../lib/helpers/constants';

describe('Vault - protocol fees', () => {
  let admin: SignerWithAddress;
  let user: SignerWithAddress;
  let feeSetter: SignerWithAddress;
  let feeCollector: SignerWithAddress;
  let other: SignerWithAddress;

  let authorizer: Contract;
  let vault: Contract;
  let tokens: TokenList;

  before('setup', async () => {
    [, admin, user, feeSetter, feeCollector, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault', async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address, ZERO_ADDRESS, 0, 0] });

    const SET_PROTOCOL_FEES_ROLE = roleId(vault, 'setProtocolFees');
    await authorizer.connect(admin).grantRole(SET_PROTOCOL_FEES_ROLE, feeSetter.address);

    tokens = await TokenList.create(['DAI', 'MKR'], { sorted: true });
    await tokens.mint({ to: user, amount: bn(100e18) });
    await tokens.approve({ to: vault, from: user });
  });

  describe('set fees', () => {
    const MAX_SWAP_FEE = bn(50e16); // 50%
    const MAX_WITHDRAW_FEE = bn(0.5e16); // 0.5%
    const MAX_FLASH_LOAN_FEE = bn(1e16); // 1%

    context('when the sender is allowed', () => {
      context('when the given input is valid', async () => {
        it('sets fees properly', async () => {
          await vault.connect(feeSetter).setProtocolFees(MAX_SWAP_FEE, MAX_WITHDRAW_FEE, MAX_FLASH_LOAN_FEE);

          const { swapFee, withdrawFee, flashLoanFee } = await vault.getProtocolFees();
          expect(swapFee).to.equal(MAX_SWAP_FEE);
          expect(withdrawFee).to.equal(MAX_WITHDRAW_FEE);
          expect(flashLoanFee).to.equal(MAX_FLASH_LOAN_FEE);
        });
      });

      context('when the given input is valid', async () => {
        it('reverts if the swap fee is above the maximum', async () => {
          const badSwapFee = MAX_SWAP_FEE.add(1);

          await expect(
            vault.connect(feeSetter).setProtocolFees(badSwapFee, MAX_WITHDRAW_FEE, MAX_FLASH_LOAN_FEE)
          ).to.be.revertedWith('SWAP_FEE_TOO_HIGH');
        });

        it('reverts if the withdraw fee is above the maximum', async () => {
          const badWithdrawFee = MAX_WITHDRAW_FEE.add(1);

          await expect(
            vault.connect(feeSetter).setProtocolFees(MAX_SWAP_FEE, badWithdrawFee, MAX_FLASH_LOAN_FEE)
          ).to.be.revertedWith('WITHDRAW_FEE_TOO_HIGH');
        });

        it('reverts if the flash loan fee is above the maximum', async () => {
          const badFlashLoanFee = MAX_FLASH_LOAN_FEE.add(1);

          await expect(
            vault.connect(feeSetter).setProtocolFees(MAX_SWAP_FEE, MAX_WITHDRAW_FEE, badFlashLoanFee)
          ).to.be.revertedWith('FLASH_LOAN_FEE_TOO_HIGH');
        });
      });
    });

    context('when the sender is not allowed', () => {
      it('reverts', async () => {
        await expect(
          vault.connect(other).setProtocolFees(MAX_SWAP_FEE, MAX_WITHDRAW_FEE, MAX_FLASH_LOAN_FEE)
        ).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });
  });

  describe('collected fees', () => {
    it('fees are initially zero', async () => {
      expect(await vault.getCollectedFees([tokens.DAI.address])).to.deep.equal([bn(0)]);
    });

    context('with collected protocol fees', () => {
      sharedBeforeEach('simulate deposits and withdraws', async () => {
        // Set a non-zero withdraw fee
        await vault.connect(feeSetter).setProtocolFees(0, bn(0.5e16), 0);

        await vault.connect(user).depositToInternalBalance([
          { asset: tokens.DAI.address, amount: bn(20e18), sender: user.address, recipient: user.address },
          { asset: tokens.MKR.address, amount: bn(20e18), sender: user.address, recipient: user.address },
        ]);

        // Withdraw internal balance - this will cause withdraw fees to be charged
        await vault.connect(user).withdrawFromInternalBalance([
          { asset: tokens.DAI.address, amount: bn(5e18), sender: user.address, recipient: user.address },
          { asset: tokens.MKR.address, amount: bn(10e18), sender: user.address, recipient: user.address },
        ]);
      });

      it('reports collected fee', async () => {
        const collectedFees = await vault.getCollectedFees(tokens.addresses);
        expect(collectedFees).to.deep.equal([bn(0.025e18), bn(0.05e18)]);
      });

      it('authorized accounts can withdraw protocol fees to any recipient', async () => {
        const role = roleId(vault, 'withdrawCollectedFees');
        await authorizer.connect(admin).grantRole(role, feeCollector.address);

        await expectBalanceChange(
          () =>
            vault
              .connect(feeCollector)
              .withdrawCollectedFees(
                [tokens.DAI.address, tokens.MKR.address],
                [bn(0.02e18), bn(0.04e18)],
                other.address
              ),
          tokens,
          { account: other, changes: { DAI: bn(0.02e18), MKR: bn(0.04e18) } }
        );

        const collectedFees = await vault.getCollectedFees(tokens.addresses);
        expect(collectedFees).to.deep.equal([bn(0.005e18), bn(0.01e18)]);
      });

      it('protocol fees cannot be over-withdrawn', async () => {
        const role = roleId(vault, 'withdrawCollectedFees');
        await authorizer.connect(admin).grantRole(role, feeCollector.address);

        await expect(
          vault.connect(feeCollector).withdrawCollectedFees([tokens.DAI.address], [bn(0.05e18).add(1)], other.address)
        ).to.be.revertedWith('INSUFFICIENT_COLLECTED_FEES');
      });

      it('unauthorized accounts cannot withdraw collected fees', async () => {
        await expect(
          vault.connect(other).withdrawCollectedFees([tokens.DAI.address], [0], other.address)
        ).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });
  });
});
