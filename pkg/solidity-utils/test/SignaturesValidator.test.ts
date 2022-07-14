import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from '@ethersproject/contracts';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { BigNumberish, bn } from '@balancer-labs/v2-helpers/src/numbers';
import { currentTimestamp } from '@balancer-labs/v2-helpers/src/time';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

describe('SignaturesValidator', () => {
  let validator: Contract;
  let signer: SignerWithAddress | Contract;
  let nonce: BigNumberish;
  let getSignature: (amount?: BigNumberish) => Promise<string>;
  const AMOUNT = 42;

  sharedBeforeEach('deploy validator', async () => {
    validator = await deploy('SignaturesValidatorMock');
  });

  const setNonceOffset = (offset = 0) => {
    beforeEach(`set nonce with offset ${offset}`, async () => {
      // mock at least one nonce in case we want to test with an old one
      await validator.increaseNonce(signer.address);
      const nextNonce = await validator.getNextNonce(signer.address);
      nonce = nextNonce.add(offset);
    });
  };

  function itChecksSignaturesCorrectly() {
    describe('signature validation', () => {
      context('without deadline', () => {
        context('when the signature is well formed', () => {
          const itReverts = (reason?: string) => {
            it('reverts', async () => {
              await expect(
                validator.authenticatedCall(signer.address, AMOUNT, await getSignature())
              ).to.be.revertedWith(reason ?? 'INVALID_SIGNATURE');
            });
          };

          context('when the given nonce is the next one', () => {
            setNonceOffset(0);

            context('when the signature is for other data', () => {
              it('reverts', async () => {
                await expect(
                  validator.authenticatedCall(signer.address, AMOUNT, await getSignature(AMOUNT + 1))
                ).to.be.revertedWith('INVALID_SIGNATURE');
              });
            });

            context('when the signature is for the correct data', () => {
              it('allows the sender', async () => {
                const tx = await validator.authenticatedCall(signer.address, AMOUNT, await getSignature());

                expectEvent.inIndirectReceipt(await tx.wait(), validator.interface, 'Authenticated');
              });

              it('increases the nonce of the signer', async () => {
                const previousNonce = await validator.getNextNonce(signer.address);

                await validator.authenticatedCall(signer.address, AMOUNT, await getSignature());

                const nextNonce = await validator.getNextNonce(signer.address);
                expect(nextNonce).to.be.equal(previousNonce.add(1));
              });

              it('does not allow using the same signature twice', async () => {
                const signature = await getSignature();
                await validator.authenticatedCall(signer.address, AMOUNT, signature);

                await expect(validator.authenticatedCall(signer.address, AMOUNT, signature)).to.be.revertedWith(
                  'INVALID_SIGNATURE'
                );
              });
            });
          });

          context('when the given nonce is a past one', () => {
            setNonceOffset(-1);

            itReverts();
          });

          context('when the given nonce is a future one', () => {
            setNonceOffset(1);
            itReverts();
          });
        });
      });

      describe('with deadline', () => {
        let deadline: BigNumberish;

        const setDeadlineOffset = (offset = 0) => {
          beforeEach(`set deadline with offset ${offset}`, async () => {
            const now = await currentTimestamp();
            deadline = now.add(offset);
          });
        };

        context('when the signature is well formed', () => {
          const itReverts = (reason?: string) => {
            it('reverts', async () => {
              await expect(
                validator.authenticatedCallWithDeadline(signer.address, AMOUNT, await getSignature(), deadline)
              ).to.be.revertedWith(reason ?? 'INVALID_SIGNATURE');
            });
          };

          context('when the given nonce is the next one', () => {
            setNonceOffset(0);

            context('when the deadline is in the past', () => {
              setDeadlineOffset(-100);

              itReverts('EXPIRED_SIGNATURE');
            });

            context('when the deadline is in the future', () => {
              setDeadlineOffset(60 * 60);

              context('when the signature is for other data', () => {
                it('reverts', async () => {
                  await expect(
                    validator.authenticatedCallWithDeadline(
                      signer.address,
                      AMOUNT,
                      await getSignature(AMOUNT + 1),
                      deadline
                    )
                  ).to.be.revertedWith('INVALID_SIGNATURE');
                });
              });

              context('when the signature is for the correct data', () => {
                it('allows the sender', async () => {
                  const tx = await validator.authenticatedCallWithDeadline(
                    signer.address,
                    AMOUNT,
                    await getSignature(),
                    deadline
                  );

                  expectEvent.inIndirectReceipt(await tx.wait(), validator.interface, 'Authenticated');
                });

                it('increases the nonce of the signer', async () => {
                  const previousNonce = await validator.getNextNonce(signer.address);

                  await validator.authenticatedCallWithDeadline(signer.address, AMOUNT, await getSignature(), deadline);

                  const nextNonce = await validator.getNextNonce(signer.address);
                  expect(nextNonce).to.be.equal(previousNonce.add(1));
                });

                it('does not allow using the same signature twice', async () => {
                  await validator.authenticatedCallWithDeadline(signer.address, AMOUNT, await getSignature(), deadline);

                  await expect(
                    validator.authenticatedCallWithDeadline(signer.address, AMOUNT, await getSignature(), deadline)
                  ).to.be.revertedWith('INVALID_SIGNATURE');
                });
              });
            });
          });

          context('when the given nonce is a past one', () => {
            setNonceOffset(-1);

            context('when the deadline is in the past', () => {
              setDeadlineOffset(-100);

              itReverts();
            });

            context('when the deadline is in the future', () => {
              setDeadlineOffset(60 * 60);

              itReverts();
            });
          });

          context('when the given nonce is a future one', () => {
            setNonceOffset(1);

            context('when the deadline is in the past', () => {
              setDeadlineOffset(-100);

              itReverts();
            });

            context('when the deadline is in the future', () => {
              setDeadlineOffset(60 * 60);

              itReverts();
            });
          });
        });
      });
    });
  }

  context('when the signer is an EOA', () => {
    before('setup signer', async () => {
      [, signer] = await ethers.getSigners();
    });

    before('setup signing', () => {
      getSignature = async function (amount?: BigNumberish): Promise<string> {
        const { chainId } = await validator.provider.getNetwork();

        const domain = {
          name: 'EOA Signatures Validator Mock',
          version: '1',
          chainId,
          verifyingContract: validator.address,
        };

        const types = {
          Authenticate: [
            { name: 'amount', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
          ],
        };

        const values = {
          amount: (amount ?? AMOUNT).toString(),
          nonce: nonce.toString(),
        };

        return (signer as SignerWithAddress)._signTypedData(domain, types, values);
      };
    });

    describe('malformed signature', () => {
      context('without deadline', () => {
        it('reverts', async () => {
          // The signature must be 65 bytes long

          await expect(validator.authenticatedCall(ZERO_ADDRESS, 0, '0x'.concat('00'.repeat(64)))).to.be.revertedWith(
            'MALFORMED_SIGNATURE'
          );

          await expect(validator.authenticatedCall(ZERO_ADDRESS, 0, '0x'.concat('00'.repeat(66)))).to.be.revertedWith(
            'MALFORMED_SIGNATURE'
          );
        });
      });

      context('with deadline', () => {
        it('reverts', async () => {
          // The signature must be 65 bytes long

          await expect(
            validator.authenticatedCallWithDeadline(ZERO_ADDRESS, 0, '0x'.concat('00'.repeat(64)), 0)
          ).to.be.revertedWith('MALFORMED_SIGNATURE');

          await expect(
            validator.authenticatedCallWithDeadline(ZERO_ADDRESS, 0, '0x'.concat('00'.repeat(66)), 0)
          ).to.be.revertedWith('MALFORMED_SIGNATURE');
        });
      });
    });

    itChecksSignaturesCorrectly();
  });

  context('when the signer is a contract', () => {
    beforeEach('deploy signer', async () => {
      signer = await deploy('ERC1271Mock');
    });

    context('when the contract accepts the signature as valid', () => {
      before('setup signing', () => {
        getSignature = async function (amount?: BigNumberish): Promise<string> {
          amount = amount ?? AMOUNT;

          const digest = await (validator as Contract).getDigest(amount, nonce);
          const signature = bn(`${amount.toString()}${nonce.toString()}`).toHexString();

          const erc1271 = signer as Contract;
          await erc1271.setApproved(await erc1271.getKey(digest, signature));

          return signature;
        };
      });

      itChecksSignaturesCorrectly();
    });

    context('when the contract does not accept the signature as valid', () => {
      setNonceOffset(0);

      context('without deadline', () => {
        it('reverts', async () => {
          await expect(validator.authenticatedCall(signer.address, AMOUNT, '0x')).to.be.revertedWith(
            'INVALID_SIGNATURE'
          );
        });
      });

      context('with deadline', () => {
        it('reverts', async () => {
          await expect(
            validator.authenticatedCallWithDeadline(signer.address, AMOUNT, '0x', MAX_UINT256)
          ).to.be.revertedWith('INVALID_SIGNATURE');
        });
      });
    });

    context('when the contract reverts', () => {
      beforeEach(async () => {
        await (signer as Contract).setRevert(true);
      });

      context('when the signature is correct', () => {
        setNonceOffset(0);

        context('without deadline', () => {
          it('reverts', async () => {
            await expect(validator.authenticatedCall(signer.address, AMOUNT, await getSignature())).to.be.revertedWith(
              'ERC1271_MOCK_REVERT'
            );
          });
        });

        context('with deadline', () => {
          it('reverts', async () => {
            await expect(
              validator.authenticatedCallWithDeadline(signer.address, AMOUNT, await getSignature(), MAX_UINT256)
            ).to.be.revertedWith('ERC1271_MOCK_REVERT');
          });
        });
      });
    });
  });
});
