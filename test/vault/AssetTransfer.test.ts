import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList, { ETH_TOKEN_ADDRESS } from '../helpers/models/tokens/TokenList';

import { deploy } from '../../lib/helpers/deploy';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { bn, FP_SCALING_FACTOR, min } from '../../lib/helpers/numbers';
import { expect } from 'chai';

describe('Vault - asset transfer', function () {
  let assetTransfer: Contract;
  let sender: SignerWithAddress, recipient: SignerWithAddress, other: SignerWithAddress;
  let tokens: TokenList;

  before('set up signers', async () => {
    [, sender, recipient, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy contracts and mint tokens', async () => {
    tokens = await TokenList.create(['WETH', 'DAI', 'MKR']);
    assetTransfer = await deploy('MockAssetTransfer', { args: [tokens.WETH.address] });

    await tokens.mint({ to: [sender, recipient, assetTransfer.address], amount: bn(100e18) });
    await tokens.approve({ to: assetTransfer.address, from: [sender, recipient] });

    // WETH tokens are special as they need to be properly minted in the WETH contract in order to be fully usable:
    // otherwise, the withdraw function will fail due to a lack of ETH.
    const weth = await ethers.getContractAt('WETH', tokens.WETH.address);
    await weth.connect(other).deposit({ value: bn(100e18) });
    await weth.connect(other).transfer(assetTransfer.address, bn(100e18));
  });

  const amount = bn(1e18);
  let asset: string;

  describe('receiveAsset', () => {
    let fromInternalBalance: boolean;

    context('when the asset is ETH', () => {
      beforeEach(() => {
        asset = ETH_TOKEN_ADDRESS;
      });

      context('with some internal balance', () => {
        sharedBeforeEach('deposit less than amount to internal balance', async () => {
          await assetTransfer.depositToInternalBalance(sender.address, tokens.WETH.address, amount.div(2));
        });

        context('when receiving from internal balance', () => {
          beforeEach(() => {
            fromInternalBalance = true;
          });

          itReceivesEtherCorrectly();
        });

        context('when not receiving from internal balance', () => {
          beforeEach(() => {
            fromInternalBalance = false;
          });

          itReceivesEtherCorrectly();
        });

        function itReceivesEtherCorrectly() {
          it('takes ETH from the caller', async () => {
            const callerBalanceBefore = await ethers.provider.getBalance(other.address);

            const gasPrice = 1;
            const receipt: ContractReceipt = await (
              await assetTransfer
                .connect(other)
                .receiveAsset(asset, amount, sender.address, fromInternalBalance, { value: amount, gasPrice })
            ).wait();
            const txETH = receipt.gasUsed.mul(gasPrice);

            const callerBalanceAfter = await ethers.provider.getBalance(other.address);

            expect(callerBalanceBefore.sub(callerBalanceAfter)).to.equal(amount.add(txETH));
          });

          it('does not keep any ETH', async () => {
            const balanceBefore = await ethers.provider.getBalance(assetTransfer.address);

            await assetTransfer.receiveAsset(asset, amount, sender.address, fromInternalBalance, { value: amount });

            const balanceAfter = await ethers.provider.getBalance(assetTransfer.address);

            expect(balanceAfter).to.equal(balanceBefore);
          });

          it('wraps received ETH into WETH', async () => {
            await expectBalanceChange(
              () => assetTransfer.receiveAsset(asset, amount, sender.address, fromInternalBalance, { value: amount }),
              tokens,
              { account: assetTransfer.address, changes: { WETH: amount } }
            );
          });

          it('returns extra ETH to the caller', async () => {
            const callerBalanceBefore = await ethers.provider.getBalance(other.address);

            const gasPrice = 1;
            const receipt: ContractReceipt = await (
              await assetTransfer
                .connect(other)
                .receiveAsset(asset, amount, sender.address, fromInternalBalance, { value: amount.mul(2), gasPrice })
            ).wait();
            const txETH = receipt.gasUsed.mul(gasPrice);

            const callerBalanceAfter = await ethers.provider.getBalance(other.address);

            expect(callerBalanceBefore.sub(callerBalanceAfter)).to.equal(amount.add(txETH));
          });

          it('does take WETH from internal balance', async () => {
            const preTransferBalance = await assetTransfer.getInternalBalance(sender.address, tokens.WETH.address);

            await assetTransfer.receiveAsset(asset, amount, sender.address, fromInternalBalance, { value: amount });

            const postTransferBalance = await assetTransfer.getInternalBalance(sender.address, tokens.WETH.address);

            expect(preTransferBalance.sub(postTransferBalance)).to.equal(0);
          });

          it('reverts if not enough ETH was sent', async () => {
            await expect(
              assetTransfer.receiveAsset(asset, amount, sender.address, fromInternalBalance, { value: amount.sub(1) })
            ).to.be.revertedWith('INSUFFICIENT_ETH');
          });
        }
      });
    });

    context('when the asset is a token', () => {
      beforeEach(() => {
        asset = tokens.DAI.address;
      });

      context('when receiving from internal balance', () => {
        beforeEach(() => {
          fromInternalBalance = true;
        });

        context('with no internal balance', () => {
          itReceivesTokenFromInternalBalanceCorrectly();
        });

        context('with some internal balance', () => {
          sharedBeforeEach('deposit less than amount to internal balance', async () => {
            await assetTransfer.depositToInternalBalance(sender.address, tokens.DAI.address, amount.div(2));
          });

          itReceivesTokenFromInternalBalanceCorrectly();
        });

        context('with enough internal balance', () => {
          sharedBeforeEach('deposit more than amount to internal balance', async () => {
            await assetTransfer.depositToInternalBalance(sender.address, tokens.DAI.address, amount.mul(2));
          });

          itReceivesTokenFromInternalBalanceCorrectly();
        });

        function itReceivesTokenFromInternalBalanceCorrectly() {
          let expectedInternalBalanceTransferAmount: BigNumber;

          sharedBeforeEach('compute expected amounts', async () => {
            const currentInternalBalance: BigNumber = await assetTransfer.getInternalBalance(
              sender.address,
              tokens.DAI.address
            );

            // When receiving from internal balance, the amount of internal balance to pull is limited by the lower of
            // the current balance and the transfer amount.
            expectedInternalBalanceTransferAmount = min(currentInternalBalance, amount);
          });

          it('deducts the expected amount from internal balance', async () => {
            const preTransferBalance = await assetTransfer.getInternalBalance(sender.address, asset);

            await assetTransfer.receiveAsset(asset, amount, sender.address, fromInternalBalance);

            const postTransferBalance = await assetTransfer.getInternalBalance(sender.address, asset);

            expect(preTransferBalance.sub(postTransferBalance)).to.equal(expectedInternalBalanceTransferAmount);
          });

          it('transfers tokens not taken from internal balance from sender', async () => {
            const expectedTransferAmount = amount.sub(expectedInternalBalanceTransferAmount);

            await expectBalanceChange(
              () => assetTransfer.receiveAsset(asset, amount, sender.address, fromInternalBalance),
              tokens,
              [
                { account: assetTransfer, changes: { DAI: expectedTransferAmount } },
                { account: sender, changes: { DAI: expectedTransferAmount.mul(-1) } },
              ]
            );
          });
        }
      });

      context('when not receiving from internal balance', () => {
        beforeEach(() => {
          fromInternalBalance = false;
        });

        context('with no internal balance', () => {
          itReceivesTokensNotFromInternalBalanceCorrectly();
        });

        context('with some internal balance', () => {
          sharedBeforeEach('deposit less than amount to internal balance', async () => {
            await assetTransfer.depositToInternalBalance(sender.address, tokens.DAI.address, amount.div(2));
          });

          itReceivesTokensNotFromInternalBalanceCorrectly();
        });

        function itReceivesTokensNotFromInternalBalanceCorrectly() {
          it('does not affect sender internal balance', async () => {
            const preTransferBalance = await assetTransfer.getInternalBalance(sender.address, asset);

            await assetTransfer.receiveAsset(asset, amount, sender.address, fromInternalBalance);

            const postTransferBalance = await assetTransfer.getInternalBalance(sender.address, asset);

            expect(postTransferBalance).to.equal(preTransferBalance);
          });

          it('transfers tokens from sender', async () => {
            await expectBalanceChange(() => assetTransfer.receiveAsset(asset, amount, sender.address, false), tokens, [
              { account: assetTransfer, changes: { DAI: amount } },
              { account: sender, changes: { DAI: amount.mul(-1) } },
            ]);
          });
        }
      });
    });
  });

  describe('sendAsset', () => {
    let toInternalBalance: boolean;

    const withdrawFee = bn(1e16); // 0.01, or 1%
    let amountMinusFees: BigNumber;

    sharedBeforeEach('set withdraw fee', async () => {
      await assetTransfer.setProtocolWithdrawFeePercentage(withdrawFee);
    });

    context('when the asset is ETH', () => {
      beforeEach(() => {
        asset = ETH_TOKEN_ADDRESS;
      });

      context('when not sending to internal balance', () => {
        itSendsEtherCorrectlyUsingOrNotInternalBalance(false);
      });

      context('when sending to internal balance', () => {
        itSendsEtherCorrectlyUsingOrNotInternalBalance(true);
      });

      function itSendsEtherCorrectlyUsingOrNotInternalBalance(sendToInternalBalance: boolean) {
        beforeEach(() => {
          toInternalBalance = sendToInternalBalance;
        });

        context('when not charging withdraw fees', () => {
          itSendsEtherCorrectlyChargingOrNotWithdrawFees(false);
        });

        context('when charging withdraw fees', () => {
          itSendsEtherCorrectlyChargingOrNotWithdrawFees(true);
        });
      }

      function itSendsEtherCorrectlyChargingOrNotWithdrawFees(chargeWithdrawFee: boolean) {
        beforeEach(() => {
          amountMinusFees = chargeWithdrawFee ? amount.sub(amount.mul(withdrawFee).div(FP_SCALING_FACTOR)) : amount;
        });

        it('sends ETH to the recipient', async () => {
          const recipientBalanceBefore = await ethers.provider.getBalance(recipient.address);

          await assetTransfer.sendAsset(asset, amount, recipient.address, toInternalBalance, chargeWithdrawFee);

          const recipientBalanceAfter = await ethers.provider.getBalance(recipient.address);

          expect(recipientBalanceAfter.sub(recipientBalanceBefore)).to.equal(amountMinusFees);
        });

        it('does not affect the ETH balance', async () => {
          const recipientBalanceBefore = await ethers.provider.getBalance(recipient.address);

          await assetTransfer.sendAsset(asset, amount, recipient.address, toInternalBalance, chargeWithdrawFee);

          const recipientBalanceAfter = await ethers.provider.getBalance(recipient.address);

          expect(recipientBalanceAfter.sub(recipientBalanceBefore)).to.equal(amountMinusFees);
        });

        it('unwraps WETH into ETH', async () => {
          await expectBalanceChange(
            () => assetTransfer.sendAsset(asset, amount, recipient.address, toInternalBalance, chargeWithdrawFee),
            tokens,
            { account: assetTransfer.address, changes: { WETH: amountMinusFees.mul(-1) } }
          );
        });

        it('does not use internal balance', async () => {
          const recipientInternalBalanceBefore = await assetTransfer.getInternalBalance(recipient.address, asset);

          await assetTransfer.sendAsset(asset, amount, recipient.address, toInternalBalance, chargeWithdrawFee);

          const recipientInternalBalanceAfter = await assetTransfer.getInternalBalance(recipient.address, asset);

          expect(recipientInternalBalanceAfter).to.equal(recipientInternalBalanceBefore);
        });

        it('returns the withdraw fee', async () => {
          expect(
            await assetTransfer.callStatic.sendAsset(
              asset,
              amount,
              recipient.address,
              toInternalBalance,
              chargeWithdrawFee
            )
          ).to.equal(amount.sub(amountMinusFees));
        });
      }
    });

    context('when the asset is not ETH', () => {
      beforeEach(() => {
        asset = tokens.DAI.address;
      });

      context('when not charging withdraw fees', () => {
        itSendsTokensCorrectlyChargingOrNotWithdrawFees(false);
      });

      context('when charging withdraw fees', () => {
        itSendsTokensCorrectlyChargingOrNotWithdrawFees(true);
      });

      function itSendsTokensCorrectlyChargingOrNotWithdrawFees(chargeWithdrawFee: boolean) {
        beforeEach(() => {
          amountMinusFees = chargeWithdrawFee ? amount.sub(amount.mul(withdrawFee).div(FP_SCALING_FACTOR)) : amount;
        });

        context('when not sending to internal balance', () => {
          itSendsTokensCorrectlyNotUsingInternalBalance();
        });

        context('when sending to internal balance', () => {
          itSendsTokensCorrectlyUsingInternalBalance();
        });

        function itSendsTokensCorrectlyNotUsingInternalBalance() {
          beforeEach(() => {
            toInternalBalance = false;
          });

          it('sends tokens to the recipient', async () => {
            await expectBalanceChange(
              () => assetTransfer.sendAsset(asset, amount, recipient.address, toInternalBalance, chargeWithdrawFee),
              tokens,
              [
                { account: recipient, changes: { DAI: amountMinusFees } },
                { account: assetTransfer.address, changes: { DAI: amountMinusFees.mul(-1) } },
              ]
            );
          });

          it('does not affect internal balance', async () => {
            const recipientInternalBalanceBefore = await assetTransfer.getInternalBalance(recipient.address, asset);

            await assetTransfer.sendAsset(asset, amount, recipient.address, toInternalBalance, chargeWithdrawFee);

            const recipientInternalBalanceAfter = await assetTransfer.getInternalBalance(recipient.address, asset);

            expect(recipientInternalBalanceAfter).to.equal(recipientInternalBalanceBefore);
          });

          it('returns the withdraw fee', async () => {
            expect(
              await assetTransfer.callStatic.sendAsset(
                asset,
                amount,
                recipient.address,
                toInternalBalance,
                chargeWithdrawFee
              )
            ).to.equal(amount.sub(amountMinusFees));
          });
        }

        function itSendsTokensCorrectlyUsingInternalBalance() {
          beforeEach(() => {
            toInternalBalance = true;
          });

          it('assigns tokens as internal balance not charging a withdraw fee', async () => {
            const recipientInternalBalanceBefore = await assetTransfer.getInternalBalance(recipient.address, asset);

            await assetTransfer.sendAsset(asset, amount, recipient.address, toInternalBalance, chargeWithdrawFee);

            const recipientInternalBalanceAfter = await assetTransfer.getInternalBalance(recipient.address, asset);

            // Note balance increases by amount, not by amountMinusFees
            expect(recipientInternalBalanceAfter.sub(recipientInternalBalanceBefore)).to.equal(amount);
          });

          it('transfers no tokens', async () => {
            await expectBalanceChange(
              () => assetTransfer.sendAsset(asset, amount, recipient.address, toInternalBalance, chargeWithdrawFee),
              tokens,
              { account: assetTransfer.address }
            );
          });

          it('returns a zero withdraw fee', async () => {
            expect(
              await assetTransfer.callStatic.sendAsset(
                asset,
                amount,
                recipient.address,
                toInternalBalance,
                chargeWithdrawFee
              )
            ).to.equal(0);
          });
        }
      }
    });
  });
});
