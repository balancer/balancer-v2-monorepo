import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList, { ETH_TOKEN_ADDRESS } from '../helpers/models/tokens/TokenList';

import { deploy } from '../../lib/helpers/deploy';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { bn, FP_SCALING_FACTOR, min } from '../../lib/helpers/numbers';
import { expect } from 'chai';

describe('Vault - asset transfers handler', function () {
  let handler: Contract;
  let sender: SignerWithAddress, recipient: SignerWithAddress, other: SignerWithAddress;
  let tokens: TokenList;

  before('set up signers', async () => {
    [, sender, recipient, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy contracts and mint tokens', async () => {
    tokens = await TokenList.create(['WETH', 'DAI', 'MKR']);
    handler = await deploy('MockAssetTransfersHandler', { args: [tokens.WETH.address] });

    await tokens.mint({ to: [sender, recipient, handler], amount: bn(100e18) });
    await tokens.approve({ to: handler, from: [sender, recipient] });

    // WETH tokens are special as they need to be properly minted in the WETH contract in order to be fully usable:
    // otherwise, the withdraw function will fail due to a lack of ETH.
    const weth = await ethers.getContractAt('WETH', tokens.WETH.address);
    await weth.connect(other).deposit({ value: bn(100e18) });
    await weth.connect(other).transfer(handler.address, bn(100e18));
  });

  const amount = bn(1e18);
  let asset: string;

  describe('receiveAsset', () => {
    context('when the asset is ETH', () => {
      beforeEach(() => {
        asset = ETH_TOKEN_ADDRESS;
      });

      context('with some internal balance', () => {
        sharedBeforeEach('deposit less than amount to internal balance', async () => {
          await handler.depositToInternalBalance(sender.address, tokens.WETH.address, amount.div(2));
        });

        context('when receiving from internal balance', () => {
          itReceivesEtherCorrectly(true);
        });

        context('when not receiving from internal balance', () => {
          itReceivesEtherCorrectly(false);
        });

        function itReceivesEtherCorrectly(fromInternalBalance: boolean) {
          it('takes ETH from the caller', async () => {
            const callerBalanceBefore = await ethers.provider.getBalance(other.address);

            const gasPrice = 1;
            const receipt: ContractReceipt = await (
              await handler
                .connect(other)
                .receiveAsset(asset, amount, sender.address, fromInternalBalance, { value: amount, gasPrice })
            ).wait();
            const txETH = receipt.gasUsed.mul(gasPrice);

            const callerBalanceAfter = await ethers.provider.getBalance(other.address);

            expect(callerBalanceBefore.sub(callerBalanceAfter)).to.equal(amount.add(txETH));
          });

          it('does not keep any ETH', async () => {
            const balanceBefore = await ethers.provider.getBalance(handler.address);

            await handler.receiveAsset(asset, amount, sender.address, fromInternalBalance, { value: amount });

            const balanceAfter = await ethers.provider.getBalance(handler.address);

            expect(balanceAfter).to.equal(balanceBefore);
          });

          it('wraps received ETH into WETH', async () => {
            await expectBalanceChange(
              () => handler.receiveAsset(asset, amount, sender.address, fromInternalBalance, { value: amount }),
              tokens,
              { account: handler.address, changes: { WETH: amount } }
            );
          });

          it('returns extra ETH to the caller', async () => {
            const callerBalanceBefore = await ethers.provider.getBalance(other.address);

            const gasPrice = 1;
            const receipt: ContractReceipt = await (
              await handler
                .connect(other)
                .receiveAsset(asset, amount, sender.address, fromInternalBalance, { value: amount.mul(2), gasPrice })
            ).wait();
            const txETH = receipt.gasUsed.mul(gasPrice);

            const callerBalanceAfter = await ethers.provider.getBalance(other.address);

            expect(callerBalanceBefore.sub(callerBalanceAfter)).to.equal(amount.add(txETH));
          });

          it('does take WETH from internal balance', async () => {
            const preTransferBalance = await handler.getInternalBalance(sender.address, tokens.WETH.address);

            await handler.receiveAsset(asset, amount, sender.address, fromInternalBalance, { value: amount });

            const postTransferBalance = await handler.getInternalBalance(sender.address, tokens.WETH.address);

            expect(preTransferBalance.sub(postTransferBalance)).to.be.zero;
          });

          it('reverts if not enough ETH was sent', async () => {
            await expect(
              handler.receiveAsset(asset, amount, sender.address, fromInternalBalance, { value: amount.sub(1) })
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
        context('with no internal balance', () => {
          itReceivesTokenFromInternalBalanceCorrectly();
        });

        context('with some internal balance', () => {
          sharedBeforeEach('deposit less than amount to internal balance', async () => {
            await handler.depositToInternalBalance(sender.address, tokens.DAI.address, amount.div(2));
          });

          itReceivesTokenFromInternalBalanceCorrectly();
        });

        context('with enough internal balance', () => {
          sharedBeforeEach('deposit more than amount to internal balance', async () => {
            await handler.depositToInternalBalance(sender.address, tokens.DAI.address, amount.mul(2));
          });

          itReceivesTokenFromInternalBalanceCorrectly();
        });

        function itReceivesTokenFromInternalBalanceCorrectly() {
          const fromInternalBalance = true;
          let expectedInternalBalanceTransferAmount: BigNumber;

          sharedBeforeEach('compute expected amounts', async () => {
            const currentInternalBalance: BigNumber = await handler.getInternalBalance(
              sender.address,
              tokens.DAI.address
            );

            // When receiving from internal balance, the amount of internal balance to pull is limited by the lower of
            // the current balance and the transfer amount.
            expectedInternalBalanceTransferAmount = min(currentInternalBalance, amount);
          });

          it('deducts the expected amount from internal balance', async () => {
            const preTransferBalance = await handler.getInternalBalance(sender.address, asset);

            await handler.receiveAsset(asset, amount, sender.address, fromInternalBalance);

            const postTransferBalance = await handler.getInternalBalance(sender.address, asset);

            expect(preTransferBalance.sub(postTransferBalance)).to.equal(expectedInternalBalanceTransferAmount);
          });

          it('transfers tokens not taken from internal balance from sender', async () => {
            const expectedTransferAmount = amount.sub(expectedInternalBalanceTransferAmount);

            await expectBalanceChange(
              () => handler.receiveAsset(asset, amount, sender.address, fromInternalBalance),
              tokens,
              [
                { account: handler, changes: { DAI: expectedTransferAmount } },
                { account: sender, changes: { DAI: expectedTransferAmount.mul(-1) } },
              ]
            );
          });
        }
      });

      context('when not receiving from internal balance', () => {
        context('with no internal balance', () => {
          itReceivesTokensNotFromInternalBalanceCorrectly();
        });

        context('with some internal balance', () => {
          sharedBeforeEach('deposit less than amount to internal balance', async () => {
            await handler.depositToInternalBalance(sender.address, tokens.DAI.address, amount.div(2));
          });

          itReceivesTokensNotFromInternalBalanceCorrectly();
        });

        function itReceivesTokensNotFromInternalBalanceCorrectly() {
          const fromInternalBalance = false;

          it('does not affect sender internal balance', async () => {
            const preTransferBalance = await handler.getInternalBalance(sender.address, asset);

            await handler.receiveAsset(asset, amount, sender.address, fromInternalBalance);

            const postTransferBalance = await handler.getInternalBalance(sender.address, asset);

            expect(postTransferBalance).to.equal(preTransferBalance);
          });

          it('transfers tokens from sender', async () => {
            await expectBalanceChange(() => handler.receiveAsset(asset, amount, sender.address, false), tokens, [
              { account: handler, changes: { DAI: amount } },
              { account: sender, changes: { DAI: amount.mul(-1) } },
            ]);
          });
        }
      });
    });
  });

  describe('sendAsset', () => {
    const withdrawFee = bn(1e16); // 0.01, or 1%
    let amountMinusFees: BigNumber;

    sharedBeforeEach('set withdraw fee', async () => {
      await handler.setProtocolWithdrawFeePercentage(withdrawFee);
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

      function itSendsEtherCorrectlyUsingOrNotInternalBalance(toInternalBalance: boolean) {
        context('when not charging withdraw fees', () => {
          itSendsEtherCorrectlyChargingOrNotWithdrawFees(toInternalBalance, false);
        });

        context('when charging withdraw fees', () => {
          itSendsEtherCorrectlyChargingOrNotWithdrawFees(toInternalBalance, true);
        });
      }

      function itSendsEtherCorrectlyChargingOrNotWithdrawFees(toInternalBalance: boolean, chargeWithdrawFee: boolean) {
        beforeEach(() => {
          amountMinusFees = chargeWithdrawFee ? amount.sub(amount.mul(withdrawFee).div(FP_SCALING_FACTOR)) : amount;
        });

        it('sends ETH to the recipient', async () => {
          const recipientBalanceBefore = await ethers.provider.getBalance(recipient.address);

          await handler.sendAsset(asset, amount, recipient.address, toInternalBalance, chargeWithdrawFee);

          const recipientBalanceAfter = await ethers.provider.getBalance(recipient.address);

          expect(recipientBalanceAfter.sub(recipientBalanceBefore)).to.equal(amountMinusFees);
        });

        it('does not affect the ETH balance', async () => {
          const recipientBalanceBefore = await ethers.provider.getBalance(recipient.address);

          await handler.sendAsset(asset, amount, recipient.address, toInternalBalance, chargeWithdrawFee);

          const recipientBalanceAfter = await ethers.provider.getBalance(recipient.address);

          expect(recipientBalanceAfter.sub(recipientBalanceBefore)).to.equal(amountMinusFees);
        });

        it('unwraps WETH into ETH', async () => {
          await expectBalanceChange(
            () => handler.sendAsset(asset, amount, recipient.address, toInternalBalance, chargeWithdrawFee),
            tokens,
            { account: handler, changes: { WETH: amountMinusFees.mul(-1) } }
          );
        });

        it('does not use internal balance', async () => {
          const recipientInternalBalanceBefore = await handler.getInternalBalance(recipient.address, asset);

          await handler.sendAsset(asset, amount, recipient.address, toInternalBalance, chargeWithdrawFee);

          const recipientInternalBalanceAfter = await handler.getInternalBalance(recipient.address, asset);

          expect(recipientInternalBalanceAfter).to.equal(recipientInternalBalanceBefore);
        });

        it('returns the withdraw fee', async () => {
          expect(
            await handler.callStatic.sendAsset(asset, amount, recipient.address, toInternalBalance, chargeWithdrawFee)
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
          const toInternalBalance = false;

          it('sends tokens to the recipient', async () => {
            await expectBalanceChange(
              () => handler.sendAsset(asset, amount, recipient.address, toInternalBalance, chargeWithdrawFee),
              tokens,
              [
                { account: recipient, changes: { DAI: amountMinusFees } },
                { account: handler, changes: { DAI: amountMinusFees.mul(-1) } },
              ]
            );
          });

          it('does not affect internal balance', async () => {
            const recipientInternalBalanceBefore = await handler.getInternalBalance(recipient.address, asset);

            await handler.sendAsset(asset, amount, recipient.address, toInternalBalance, chargeWithdrawFee);

            const recipientInternalBalanceAfter = await handler.getInternalBalance(recipient.address, asset);

            expect(recipientInternalBalanceAfter).to.equal(recipientInternalBalanceBefore);
          });

          it('returns the withdraw fee', async () => {
            expect(
              await handler.callStatic.sendAsset(asset, amount, recipient.address, toInternalBalance, chargeWithdrawFee)
            ).to.equal(amount.sub(amountMinusFees));
          });
        }

        function itSendsTokensCorrectlyUsingInternalBalance() {
          const toInternalBalance = true;

          it('assigns tokens as internal balance not charging a withdraw fee', async () => {
            const recipientInternalBalanceBefore = await handler.getInternalBalance(recipient.address, asset);

            await handler.sendAsset(asset, amount, recipient.address, toInternalBalance, chargeWithdrawFee);

            const recipientInternalBalanceAfter = await handler.getInternalBalance(recipient.address, asset);

            // Note balance increases by amount, not by amountMinusFees
            expect(recipientInternalBalanceAfter.sub(recipientInternalBalanceBefore)).to.equal(amount);
          });

          it('transfers no tokens', async () => {
            await expectBalanceChange(
              () => handler.sendAsset(asset, amount, recipient.address, toInternalBalance, chargeWithdrawFee),
              tokens,
              { account: handler }
            );
          });

          it('returns a zero withdraw fee', async () => {
            expect(
              await handler.callStatic.sendAsset(asset, amount, recipient.address, toInternalBalance, chargeWithdrawFee)
            ).to.be.zero;
          });
        }
      }
    });
  });
});
