import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList, { ETH_TOKEN_ADDRESS } from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import { bn, min } from '@balancer-labs/v2-helpers/src/numbers';
import { expect } from 'chai';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import { forceSendEth } from './helpers/eth';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('AssetTransfersHandler', function () {
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
  });

  const amount = bn(1e18);
  describe('receiveAsset', () => {
    context('when the asset is ETH', () => {
      const eth = ETH_TOKEN_ADDRESS;

      context('with some internal balance', () => {
        sharedBeforeEach('deposit less than amount to internal balance', async () => {
          await handler.depositToInternalBalance(sender.address, tokens.WETH.address, amount.div(2));
        });

        context('when not receiving from internal balance', () => {
          itReceivesEtherCorrectly();
        });

        context('when receiving from internal balance', () => {
          const fromInternalBalance = true;

          it('reverts', async () => {
            await expect(
              handler.connect(other).receiveAsset(eth, amount, sender.address, fromInternalBalance, { value: amount })
            ).to.be.revertedWith('INVALID_ETH_INTERNAL_BALANCE');
          });
        });

        function itReceivesEtherCorrectly() {
          const fromInternalBalance = false;

          it('takes ETH from the caller', async () => {
            const callerBalanceBefore = await ethers.provider.getBalance(other.address);

            const gasPrice = await ethers.provider.getGasPrice();
            const receipt: ContractReceipt = await (
              await handler
                .connect(other)
                .receiveAsset(eth, amount, sender.address, fromInternalBalance, { value: amount, gasPrice })
            ).wait();
            const txETH = receipt.gasUsed.mul(gasPrice);

            const callerBalanceAfter = await ethers.provider.getBalance(other.address);

            expect(callerBalanceBefore.sub(callerBalanceAfter)).to.equal(amount.add(txETH));
          });

          it('does not keep any ETH', async () => {
            const balanceBefore = await ethers.provider.getBalance(handler.address);

            await handler.receiveAsset(eth, amount, sender.address, fromInternalBalance, { value: amount });

            const balanceAfter = await ethers.provider.getBalance(handler.address);

            expect(balanceAfter).to.equal(balanceBefore);
          });

          it('wraps received ETH into WETH', async () => {
            await expectBalanceChange(
              () => handler.receiveAsset(eth, amount, sender.address, fromInternalBalance, { value: amount }),
              tokens,
              { account: handler.address, changes: { WETH: amount } }
            );
          });

          it('does not return extra ETH to the caller', async () => {
            const callerBalanceBefore = await ethers.provider.getBalance(other.address);

            const gasPrice = await ethers.provider.getGasPrice();
            const receipt: ContractReceipt = await (
              await handler
                .connect(other)
                .receiveAsset(eth, amount, sender.address, fromInternalBalance, { value: amount.mul(2), gasPrice })
            ).wait();
            const txETH = receipt.gasUsed.mul(gasPrice);

            const callerBalanceAfter = await ethers.provider.getBalance(other.address);

            const ethSent = txETH.add(amount.mul(2));
            expect(callerBalanceBefore.sub(callerBalanceAfter)).to.equal(ethSent);
          });

          it('does not check if any ETH was supplied', async () => {
            // Regular ETH transfers are rejected, so we use forceSendEth to get the handler to hold some ETH for it to
            // use.
            await forceSendEth(handler.address, amount);

            // Despite the caller not sending any ETH, the transaction goes through (using the handler's own balance).
            await expectBalanceChange(
              () => handler.receiveAsset(eth, amount, sender.address, fromInternalBalance, { value: 0 }),
              tokens,
              { account: handler.address, changes: { WETH: amount } }
            );
          });

          it('does take WETH from internal balance', async () => {
            const preTransferBalance = await handler.getInternalBalance(sender.address, tokens.WETH.address);

            await handler.receiveAsset(eth, amount, sender.address, fromInternalBalance, { value: amount });

            const postTransferBalance = await handler.getInternalBalance(sender.address, tokens.WETH.address);

            expect(preTransferBalance.sub(postTransferBalance)).to.be.zero;
          });

          it('reverts if not enough ETH was sent', async () => {
            await expect(
              handler.receiveAsset(eth, amount, sender.address, fromInternalBalance, { value: amount.sub(1) })
            ).to.be.revertedWith('INSUFFICIENT_ETH');
          });
        }
      });
    });

    context('when the asset is a token', () => {
      context('when the token is WETH', () => {
        itReceivesTokenCorrectly('WETH');
      });

      context('when the token is not WETH', () => {
        itReceivesTokenCorrectly('DAI');
      });

      function itReceivesTokenCorrectly(symbol: string) {
        let token: Token;

        beforeEach(() => {
          token = tokens.findBySymbol(symbol);
        });

        context('when receiving from internal balance', () => {
          context('with no internal balance', () => {
            itReceivesTokenFromInternalBalanceCorrectly();
          });

          context('with some internal balance', () => {
            sharedBeforeEach('deposit less than amount to internal balance', async () => {
              await handler.depositToInternalBalance(sender.address, token.address, amount.div(2));
            });

            itReceivesTokenFromInternalBalanceCorrectly();
          });

          context('with enough internal balance', () => {
            sharedBeforeEach('deposit more than amount to internal balance', async () => {
              await handler.depositToInternalBalance(sender.address, token.address, amount.mul(2));
            });

            itReceivesTokenFromInternalBalanceCorrectly();
          });

          function itReceivesTokenFromInternalBalanceCorrectly() {
            const fromInternalBalance = true;
            let expectedInternalBalanceTransferAmount: BigNumber;

            sharedBeforeEach('compute expected amounts', async () => {
              const currentInternalBalance: BigNumber = await handler.getInternalBalance(sender.address, token.address);

              // When receiving from internal balance, the amount of internal balance to pull is limited by the lower of
              // the current balance and the transfer amount.
              expectedInternalBalanceTransferAmount = min(currentInternalBalance, amount);
            });

            it('deducts the expected amount from internal balance', async () => {
              const preTransferBalance = await handler.getInternalBalance(sender.address, token.address);

              await handler.receiveAsset(token.address, amount, sender.address, fromInternalBalance);

              const postTransferBalance = await handler.getInternalBalance(sender.address, token.address);

              expect(preTransferBalance.sub(postTransferBalance)).to.equal(expectedInternalBalanceTransferAmount);
            });

            it('transfers tokens not taken from internal balance from sender', async () => {
              const expectedTransferAmount = amount.sub(expectedInternalBalanceTransferAmount);

              await expectBalanceChange(
                () => handler.receiveAsset(token.address, amount, sender.address, fromInternalBalance),
                tokens,
                [
                  { account: handler, changes: { [symbol]: expectedTransferAmount } },
                  { account: sender, changes: { [symbol]: expectedTransferAmount.mul(-1) } },
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
              await handler.depositToInternalBalance(sender.address, token.address, amount.div(2));
            });

            itReceivesTokensNotFromInternalBalanceCorrectly();
          });

          function itReceivesTokensNotFromInternalBalanceCorrectly() {
            const fromInternalBalance = false;

            it('does not affect sender internal balance', async () => {
              const preTransferBalance = await handler.getInternalBalance(sender.address, token.address);

              await handler.receiveAsset(token.address, amount, sender.address, fromInternalBalance);

              const postTransferBalance = await handler.getInternalBalance(sender.address, token.address);

              expect(postTransferBalance).to.equal(preTransferBalance);
            });

            it('transfers tokens from sender', async () => {
              await expectBalanceChange(
                () => handler.receiveAsset(token.address, amount, sender.address, false),
                tokens,
                [
                  { account: handler, changes: { [symbol]: amount } },
                  { account: sender, changes: { [symbol]: amount.mul(-1) } },
                ]
              );
            });
          }
        });
      }
    });
  });

  describe('sendAsset', () => {
    context('when the asset is ETH', () => {
      const eth = ETH_TOKEN_ADDRESS;

      context('when not sending to internal balance', () => {
        itSendsEtherCorrectly();
      });

      context('when sending to internal balance', () => {
        const toInternalBalance = true;

        it('reverts', async () => {
          await expect(handler.sendAsset(eth, amount, recipient.address, toInternalBalance)).to.be.revertedWith(
            'INVALID_ETH_INTERNAL_BALANCE'
          );
        });
      });

      function itSendsEtherCorrectly() {
        const toInternalBalance = false;

        it('sends ETH to the recipient', async () => {
          const recipientBalanceBefore = await ethers.provider.getBalance(recipient.address);

          await handler.sendAsset(eth, amount, recipient.address, toInternalBalance);

          const recipientBalanceAfter = await ethers.provider.getBalance(recipient.address);

          expect(recipientBalanceAfter.sub(recipientBalanceBefore)).to.equal(amount);
        });

        it('does not affect the ETH balance', async () => {
          const recipientBalanceBefore = await ethers.provider.getBalance(recipient.address);

          await handler.sendAsset(eth, amount, recipient.address, toInternalBalance);
          eth;
          const recipientBalanceAfter = await ethers.provider.getBalance(recipient.address);

          expect(recipientBalanceAfter.sub(recipientBalanceBefore)).to.equal(amount);
        });

        it('unwraps WETH into ETH', async () => {
          await expectBalanceChange(
            () => handler.sendAsset(eth, amount, recipient.address, toInternalBalance),
            tokens,
            { account: handler, changes: { WETH: amount.mul(-1) } }
          );
        });

        it('does not use internal balance', async () => {
          const recipientInternalBalanceBefore = await handler.getInternalBalance(recipient.address, eth);

          await handler.sendAsset(eth, amount, recipient.address, toInternalBalance);

          const recipientInternalBalanceAfter = await handler.getInternalBalance(recipient.address, eth);

          expect(recipientInternalBalanceAfter).to.equal(recipientInternalBalanceBefore);
        });
      }
    });

    context('when the asset is a token', () => {
      context('when the token is WETH', () => {
        itSendsTokensCorrectly('WETH');
      });

      context('when the token is not WETH', () => {
        itSendsTokensCorrectly('DAI');
      });

      function itSendsTokensCorrectly(symbol: string) {
        let token: Token;

        beforeEach(() => {
          token = tokens.findBySymbol(symbol);
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
              () => handler.sendAsset(token.address, amount, recipient.address, toInternalBalance),
              tokens,
              [
                { account: recipient, changes: { [symbol]: amount } },
                { account: handler, changes: { [symbol]: amount.mul(-1) } },
              ]
            );
          });

          it('does not affect internal balance', async () => {
            const recipientInternalBalanceBefore = await handler.getInternalBalance(recipient.address, token.address);

            await handler.sendAsset(token.address, amount, recipient.address, toInternalBalance);

            const recipientInternalBalanceAfter = await handler.getInternalBalance(recipient.address, token.address);

            expect(recipientInternalBalanceAfter).to.equal(recipientInternalBalanceBefore);
          });
        }

        function itSendsTokensCorrectlyUsingInternalBalance() {
          const toInternalBalance = true;

          it('assigns tokens as internal balance', async () => {
            const recipientInternalBalanceBefore = await handler.getInternalBalance(recipient.address, token.address);

            await handler.sendAsset(token.address, amount, recipient.address, toInternalBalance);

            const recipientInternalBalanceAfter = await handler.getInternalBalance(recipient.address, token.address);

            // Note balance increases by amount, not by amountMinusFees
            expect(recipientInternalBalanceAfter.sub(recipientInternalBalanceBefore)).to.equal(amount);
          });

          it('transfers no tokens', async () => {
            await expectBalanceChange(
              () => handler.sendAsset(token.address, amount, recipient.address, toInternalBalance),
              tokens,
              { account: handler }
            );
          });
        }
      }
    });
  });
});
