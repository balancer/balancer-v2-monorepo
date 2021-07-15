import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from '@ethersproject/contracts';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { MAX_GAS_LIMIT, ZERO_BYTES32 } from '@balancer-labs/v2-helpers/src/constants';
import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';
import { currentTimestamp } from '@balancer-labs/v2-helpers/src/time';
import { RelayerAuthorization, RelayerAction } from '@balancer-labs/balancer-js';

describe('SignaturesValidator', () => {
  let validator: Contract;
  let user: SignerWithAddress, sender: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, user, sender, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy validator', async () => {
    validator = await deploy('SignaturesValidatorMock');
  });

  describe('decoding', () => {
    let calldata: string;

    beforeEach('compute calldata', async () => {
      calldata = validator.interface.encodeFunctionData('decodeCalldata');
    });

    context('when there is no signature encoded', () => {
      it('decodes empty data', async () => {
        const tx = await user.sendTransaction({ to: validator.address, data: calldata, gasLimit: MAX_GAS_LIMIT });

        expectEvent.inIndirectReceipt(await tx.wait(), validator.interface, 'CalldataDecoded', {
          data: calldata,
          deadline: 0,
          v: 0,
          r: ZERO_BYTES32,
          s: ZERO_BYTES32,
        });
      });
    });

    context('when there is a signature encoded', () => {
      const deadline = 15;

      it('decodes it properly', async () => {
        const signature = await user.signMessage('message');
        const calldataWithSignature = await RelayerAuthorization.encodeCalldataAuthorization(
          calldata,
          deadline,
          signature
        );

        const tx = await user.sendTransaction({
          to: validator.address,
          data: calldataWithSignature,
          gasLimit: MAX_GAS_LIMIT,
        });

        const { v, r, s } = ethers.utils.splitSignature(signature);
        expectEvent.inIndirectReceipt(await tx.wait(), validator.interface, 'CalldataDecoded', {
          data: calldata,
          deadline,
          v,
          r,
          s,
        });
      });
    });
  });

  describe('authenticate', () => {
    let allowedSender: SignerWithAddress;
    let extraCalldata: undefined | string, allowedFunction: string, deadline: BigNumberish, nonce: BigNumberish;

    const itReverts = () => {
      it('reverts', async () => {
        const data = await buildCalldata();
        await expect(
          sender.sendTransaction({ to: validator.address, data, gasLimit: MAX_GAS_LIMIT })
        ).to.be.revertedWith('INVALID_SIGNATURE');
      });
    };

    const buildCalldata = async () => {
      const calldata = validator.interface.encodeFunctionData('authenticateCall', [user.address]);

      if (extraCalldata !== undefined) return `${calldata}${extraCalldata}`;
      const allowedCalldata = allowedFunction
        ? validator.interface.encodeFunctionData(allowedFunction, [user.address])
        : calldata;

      const signature = await RelayerAuthorization.signAuthorizationFor(
        'Authorization' as RelayerAction,
        validator,
        user,
        allowedSender,
        allowedCalldata,
        deadline,
        nonce
      );
      return RelayerAuthorization.encodeCalldataAuthorization(calldata, deadline, signature);
    };

    const setAllowedFunction = (fnName: string) => {
      beforeEach(`set authorized functionality ${fnName}`, async () => {
        allowedFunction = fnName;
      });
    };

    const setNonceOffset = (offset = 0) => {
      beforeEach(`set nonce with offset ${offset}`, async () => {
        // mock at least one nonce in case we want to test with an old one
        await validator.increaseNonce(user.address);
        const nextNonce = await validator.getNextNonce(user.address);
        nonce = nextNonce.add(offset);
      });
    };

    const setDeadlineOffset = (offset = 0) => {
      beforeEach(`set deadline with offset ${offset}`, async () => {
        const now = await currentTimestamp();
        deadline = now.add(offset);
      });
    };

    const setExtraCallData = (calldata: string | undefined) => {
      beforeEach('set extra calldata', async () => {
        extraCalldata = calldata;
      });
    };

    context('when there is no extra calldata given', () => {
      setExtraCallData('');

      itReverts();
    });

    context('when there is some extra calldata given', () => {
      context('when the extra calldata is malformed', () => {
        setExtraCallData('abcd');

        itReverts();
      });

      context('when the extra calldata is well formed', () => {
        setExtraCallData(undefined);

        context('when the signature allows the sender', () => {
          beforeEach('set authorized sender', async () => {
            allowedSender = sender;
          });

          context('when the given nonce is the next one', () => {
            setNonceOffset(0);

            context('when the authorized data is correct', () => {
              setAllowedFunction('authenticateCall');

              context('when the deadline is in the past', () => {
                setDeadlineOffset(-100);

                itReverts();
              });

              context('when the deadline is in the future', () => {
                setDeadlineOffset(60 * 60);

                it('allows the sender', async () => {
                  const data = await buildCalldata();
                  const tx = await sender.sendTransaction({ to: validator.address, data, gasLimit: MAX_GAS_LIMIT });

                  expectEvent.inIndirectReceipt(await tx.wait(), validator.interface, 'Authenticated', {
                    user: user.address,
                    sender: sender.address,
                  });
                });

                it('increases the nonce of the user', async () => {
                  const previousNonce = await validator.getNextNonce(user.address);

                  await sender.sendTransaction({
                    to: validator.address,
                    data: await buildCalldata(),
                    gasLimit: MAX_GAS_LIMIT,
                  });

                  const nextNonce = await validator.getNextNonce(user.address);
                  expect(nextNonce).to.be.equal(previousNonce.add(1));
                });

                it('does not allow using the same signature twice', async () => {
                  const data = await buildCalldata();
                  await sender.sendTransaction({ to: validator.address, data, gasLimit: MAX_GAS_LIMIT });

                  await expect(
                    sender.sendTransaction({ to: validator.address, data, gasLimit: MAX_GAS_LIMIT })
                  ).to.be.revertedWith('INVALID_SIGNATURE');
                });
              });
            });

            context('when the authorized functionality is not correct', () => {
              setAllowedFunction('anotherFunction');

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

          context('when the given nonce is a past one', () => {
            setNonceOffset(-1);

            context('when the authorized data is correct', () => {
              setAllowedFunction('authenticateCall');

              context('when the deadline is in the past', () => {
                setDeadlineOffset(-100);

                itReverts();
              });

              context('when the deadline is in the future', () => {
                setDeadlineOffset(60 * 60);

                itReverts();
              });
            });

            context('when the authorized functionality is not correct', () => {
              setAllowedFunction('anotherFunction');

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

          context('when the given nonce is a future one', () => {
            setNonceOffset(1);

            context('when the authorized data is correct', () => {
              setAllowedFunction('authenticateCall');

              context('when the deadline is in the past', () => {
                setDeadlineOffset(-100);

                itReverts();
              });

              context('when the deadline is in the future', () => {
                setDeadlineOffset(60 * 60);

                itReverts();
              });
            });

            context('when the authorized functionality is not correct', () => {
              setAllowedFunction('anotherFunction');

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

        context('when the signature allows another sender', () => {
          beforeEach('set authorized sender', async () => {
            allowedSender = other;
          });

          context('when the given nonce is the next one', () => {
            setNonceOffset(0);

            context('when the authorized data is correct', () => {
              setAllowedFunction('authenticateCall');

              context('when the deadline is in the past', () => {
                setDeadlineOffset(-100);

                itReverts();
              });

              context('when the deadline is in the future', () => {
                setDeadlineOffset(60 * 60);

                itReverts();
              });
            });

            context('when the authorized functionality is not correct', () => {
              setAllowedFunction('anotherFunction');

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

          context('when the given nonce is a past one', () => {
            setNonceOffset(-1);

            context('when the authorized data is correct', () => {
              setAllowedFunction('authenticateCall');

              context('when the deadline is in the past', () => {
                setDeadlineOffset(-100);

                itReverts();
              });

              context('when the deadline is in the future', () => {
                setDeadlineOffset(60 * 60);

                itReverts();
              });
            });

            context('when the authorized functionality is not correct', () => {
              setAllowedFunction('anotherFunction');

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

          context('when the given nonce is a future one', () => {
            setNonceOffset(1);

            context('when the authorized data is correct', () => {
              setAllowedFunction('authenticateCall');

              context('when the deadline is in the past', () => {
                setDeadlineOffset(-100);

                itReverts();
              });

              context('when the deadline is in the future', () => {
                setDeadlineOffset(60 * 60);

                itReverts();
              });
            });

            context('when the authorized functionality is not correct', () => {
              setAllowedFunction('anotherFunction');

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
    });
  });
});
