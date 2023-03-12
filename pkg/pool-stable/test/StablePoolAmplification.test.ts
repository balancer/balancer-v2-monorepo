import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';

import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { bn } from '@balancer-labs/v2-helpers/src/numbers';
import { advanceTime, currentTimestamp, DAY, setNextBlockTimestamp } from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { DELEGATE_OWNER } from '@balancer-labs/v2-helpers/src/constants';

describe('StablePoolAmplification', () => {
  let owner: SignerWithAddress, admin: SignerWithAddress, other: SignerWithAddress;
  let vault: Vault;

  const MIN_AMP = bn(1);
  const MAX_AMP = bn(5000);
  const AMP_PRECISION = 1e3;
  const INITIAL_AMPLIFICATION_PARAMETER = bn(200);

  sharedBeforeEach('setup signers', async () => {
    [, admin, owner, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault', async () => {
    vault = await Vault.create({ admin });
  });

  const deployPool = (owner: Account, amp = INITIAL_AMPLIFICATION_PARAMETER): Promise<Contract> =>
    deploy('MockStablePoolAmplification', {
      args: [vault.address, TypesConverter.toAddress(owner), amp],
    });

  describe('constructor', () => {
    context('when passing a valid initial amplification parameter value', () => {
      let pool: Contract;
      sharedBeforeEach('deploy pool', async () => {
        pool = await deployPool(owner);
      });

      it('sets the expected amplification parameter', async () => {
        const { value, isUpdating, precision } = await pool.getAmplificationParameter();
        expect(value).to.be.equal(INITIAL_AMPLIFICATION_PARAMETER.mul(AMP_PRECISION));
        expect(isUpdating).to.be.false;
        expect(precision).to.be.equal(AMP_PRECISION);
      });
    });

    context('when passing an initial amplification parameter less than MIN_AMP', () => {
      it('reverts', async () => {
        await expect(deployPool(owner, MIN_AMP.sub(1))).to.be.revertedWith('MIN_AMP');
      });
    });

    context('when passing an initial amplification parameter greater than MAX_AMP', () => {
      it('reverts', async () => {
        await expect(deployPool(owner, MAX_AMP.add(1))).to.be.revertedWith('MAX_AMP');
      });
    });
  });

  describe('startAmplificationParameterUpdate', () => {
    let pool: Contract;
    let caller: SignerWithAddress;

    function itStartsAnAmpUpdateCorrectly() {
      context('when requesting a reasonable change duration', () => {
        const duration = DAY * 2;
        let endTime: BigNumber;

        sharedBeforeEach('set end time', async () => {
          const startTime = (await currentTimestamp()).add(100);
          await setNextBlockTimestamp(startTime);
          endTime = startTime.add(duration);
        });

        context('when requesting a valid amp', () => {
          const itUpdatesAmpCorrectly = (newAmp: BigNumber) => {
            const increasing = INITIAL_AMPLIFICATION_PARAMETER.lt(newAmp);

            context('when there is no ongoing update', () => {
              it('starts changing the amp', async () => {
                await pool.connect(caller).startAmplificationParameterUpdate(newAmp, endTime);

                await advanceTime(duration / 3);

                const { value, isUpdating } = await pool.getAmplificationParameter();
                expect(isUpdating).to.be.true;

                if (increasing) {
                  const diff = newAmp.sub(INITIAL_AMPLIFICATION_PARAMETER).mul(AMP_PRECISION);
                  expect(value).to.be.equalWithError(
                    INITIAL_AMPLIFICATION_PARAMETER.mul(AMP_PRECISION).add(diff.div(3)),
                    0.00001
                  );
                } else {
                  const diff = INITIAL_AMPLIFICATION_PARAMETER.sub(newAmp).mul(AMP_PRECISION);
                  expect(value).to.be.equalWithError(
                    INITIAL_AMPLIFICATION_PARAMETER.mul(AMP_PRECISION).sub(diff.div(3)),
                    0.00001
                  );
                }
              });

              it('stops updating after duration', async () => {
                await pool.connect(caller).startAmplificationParameterUpdate(newAmp, endTime);

                await advanceTime(duration + 1);

                const { value, isUpdating } = await pool.getAmplificationParameter();
                expect(value).to.be.equal(newAmp.mul(AMP_PRECISION));
                expect(isUpdating).to.be.false;
              });

              it('emits an AmpUpdateStarted event', async () => {
                const receipt = await pool.connect(caller).startAmplificationParameterUpdate(newAmp, endTime);

                expectEvent.inReceipt(await receipt.wait(), 'AmpUpdateStarted', {
                  startValue: INITIAL_AMPLIFICATION_PARAMETER.mul(AMP_PRECISION),
                  endValue: newAmp.mul(AMP_PRECISION),
                  endTime,
                });
              });

              it('does not emit an AmpUpdateStopped event', async () => {
                const receipt = await pool.connect(caller).startAmplificationParameterUpdate(newAmp, endTime);
                expectEvent.notEmitted(await receipt.wait(), 'AmpUpdateStopped');
              });
            });

            context('when there is an ongoing update', () => {
              sharedBeforeEach('start change', async () => {
                await pool.connect(caller).startAmplificationParameterUpdate(newAmp, endTime);

                await advanceTime(duration / 3);
                const beforeStop = await pool.getAmplificationParameter();
                expect(beforeStop.isUpdating).to.be.true;
              });

              it('trying to start another update reverts', async () => {
                await expect(
                  pool.connect(caller).startAmplificationParameterUpdate(newAmp, endTime)
                ).to.be.revertedWith('AMP_ONGOING_UPDATE');
              });

              context('after the ongoing update is stopped', () => {
                let ampValueAfterStop: BigNumber;

                sharedBeforeEach('stop change', async () => {
                  await pool.connect(caller).stopAmplificationParameterUpdate();
                  const ampState = await pool.getAmplificationParameter();
                  ampValueAfterStop = ampState.value;
                });

                it('the new update can be started', async () => {
                  const newEndTime = (await currentTimestamp()).add(DAY * 2);
                  const startReceipt = await pool.connect(caller).startAmplificationParameterUpdate(newAmp, newEndTime);
                  const now = await currentTimestamp();
                  expectEvent.inReceipt(await startReceipt.wait(), 'AmpUpdateStarted', {
                    endValue: newAmp.mul(AMP_PRECISION),
                    startTime: now,
                    endTime: newEndTime,
                  });

                  await advanceTime(duration / 3);

                  const afterStart = await pool.getAmplificationParameter();
                  expect(afterStart.isUpdating).to.be.true;
                  expect(afterStart.value).to.be[increasing ? 'gt' : 'lt'](ampValueAfterStop);
                });
              });
            });
          };

          context('when increasing the amp', () => {
            context('when increasing the amp by 2x', () => {
              const newAmp = INITIAL_AMPLIFICATION_PARAMETER.mul(2);

              itUpdatesAmpCorrectly(newAmp);
            });
          });

          context('when decreasing the amp', () => {
            context('when decreasing the amp by 2x', () => {
              const newAmp = INITIAL_AMPLIFICATION_PARAMETER.div(2);

              itUpdatesAmpCorrectly(newAmp);
            });
          });
        });

        context('when requesting an invalid amp', () => {
          it('reverts when requesting below the min', async () => {
            const lowAmp = bn(0);
            await expect(pool.connect(caller).startAmplificationParameterUpdate(lowAmp, endTime)).to.be.revertedWith(
              'MIN_AMP'
            );
          });

          it('reverts when requesting above the max', async () => {
            const highAmp = bn(5001);
            await expect(pool.connect(caller).startAmplificationParameterUpdate(highAmp, endTime)).to.be.revertedWith(
              'MAX_AMP'
            );
          });

          describe('rate limits', () => {
            let startTime: BigNumber;

            beforeEach('set start time', async () => {
              startTime = (await currentTimestamp()).add(100);
              await setNextBlockTimestamp(startTime);
            });

            it('reverts when increasing the amp by more than 2x in a single day', async () => {
              const newAmp = INITIAL_AMPLIFICATION_PARAMETER.mul(2).add(1);
              const endTime = startTime.add(DAY);

              await expect(pool.connect(caller).startAmplificationParameterUpdate(newAmp, endTime)).to.be.revertedWith(
                'AMP_RATE_TOO_HIGH'
              );
            });

            it('reverts when increasing the amp by more than 2x daily over multiple days', async () => {
              const newAmp = INITIAL_AMPLIFICATION_PARAMETER.mul(5).add(1);
              const endTime = startTime.add(DAY * 2);

              await expect(pool.connect(caller).startAmplificationParameterUpdate(newAmp, endTime)).to.be.revertedWith(
                'AMP_RATE_TOO_HIGH'
              );
            });

            it('reverts when decreasing the amp by more than 2x in a single day', async () => {
              const newAmp = INITIAL_AMPLIFICATION_PARAMETER.div(2).sub(1);
              const endTime = startTime.add(DAY);

              await expect(pool.connect(caller).startAmplificationParameterUpdate(newAmp, endTime)).to.be.revertedWith(
                'AMP_RATE_TOO_HIGH'
              );
            });

            it('reverts when decreasing the amp by more than 2x daily over multiple days', async () => {
              const newAmp = INITIAL_AMPLIFICATION_PARAMETER.div(5).sub(1);
              const endTime = startTime.add(DAY * 2);

              await expect(pool.connect(caller).startAmplificationParameterUpdate(newAmp, endTime)).to.be.revertedWith(
                'AMP_RATE_TOO_HIGH'
              );
            });
          });
        });
      });

      context('when requesting a short duration change', () => {
        let endTime;

        it('reverts', async () => {
          endTime = (await currentTimestamp()).add(DAY).sub(1);
          await expect(
            pool.connect(caller).startAmplificationParameterUpdate(INITIAL_AMPLIFICATION_PARAMETER, endTime)
          ).to.be.revertedWith('AMP_END_TIME_TOO_CLOSE');
        });
      });
    }

    function itReverts() {
      it('reverts', async () => {
        await expect(
          pool.connect(other).startAmplificationParameterUpdate(INITIAL_AMPLIFICATION_PARAMETER, DAY)
        ).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    }

    context('with an owner', () => {
      sharedBeforeEach('deploy pool', async () => {
        pool = await deployPool(owner);
        caller = owner;
      });

      context('when the sender is allowed', () => {
        itStartsAnAmpUpdateCorrectly();
      });

      context('when the sender is not allowed', () => {
        itReverts();
      });
    });

    context('with a delegated owner', () => {
      sharedBeforeEach('deploy pool', async () => {
        pool = await deployPool(DELEGATE_OWNER);
        caller = other;
      });

      context('when the sender is allowed', () => {
        sharedBeforeEach('grant permissions', async () => {
          const startAmpChangePermission = await actionId(pool, 'startAmplificationParameterUpdate');
          const stopAmpChangePermission = await actionId(pool, 'stopAmplificationParameterUpdate');
          await vault.grantPermissionGlobally(stopAmpChangePermission, other);
          await vault.grantPermissionGlobally(startAmpChangePermission, other);
        });

        itStartsAnAmpUpdateCorrectly();
      });

      context('when the sender is not allowed', () => {
        itReverts();
      });
    });
  });

  describe('stopAmplificationParameterUpdate', () => {
    let pool: Contract;
    let caller: SignerWithAddress;

    function itStopsAnAmpUpdateCorrectly() {
      context('when there is an ongoing update', () => {
        sharedBeforeEach('start change', async () => {
          const newAmp = INITIAL_AMPLIFICATION_PARAMETER.mul(2);
          const duration = DAY * 2;

          const startTime = (await currentTimestamp()).add(100);
          await setNextBlockTimestamp(startTime);
          const endTime = startTime.add(duration);

          await pool.connect(caller).startAmplificationParameterUpdate(newAmp, endTime);

          await advanceTime(duration / 3);
          const beforeStop = await pool.getAmplificationParameter();
          expect(beforeStop.isUpdating).to.be.true;
        });

        it('stops the amp factor from updating', async () => {
          const beforeStop = await pool.getAmplificationParameter();

          await pool.connect(caller).stopAmplificationParameterUpdate();

          const afterStop = await pool.getAmplificationParameter();
          expect(afterStop.value).to.be.equalWithError(beforeStop.value, 0.001);
          expect(afterStop.isUpdating).to.be.false;

          await advanceTime(30 * DAY);

          const muchLaterAfterStop = await pool.getAmplificationParameter();
          expect(muchLaterAfterStop.value).to.be.equal(afterStop.value);
          expect(muchLaterAfterStop.isUpdating).to.be.false;
        });

        it('emits an AmpUpdateStopped event', async () => {
          const receipt = await pool.connect(caller).stopAmplificationParameterUpdate();
          expectEvent.inReceipt(await receipt.wait(), 'AmpUpdateStopped');
        });

        it('does not emit an AmpUpdateStarted event', async () => {
          const receipt = await pool.connect(caller).stopAmplificationParameterUpdate();
          expectEvent.notEmitted(await receipt.wait(), 'AmpUpdateStarted');
        });
      });

      context('when there is no ongoing update', () => {
        it('reverts', async () => {
          await expect(pool.connect(caller).stopAmplificationParameterUpdate()).to.be.revertedWith(
            'AMP_NO_ONGOING_UPDATE'
          );
        });
      });
    }

    function itReverts() {
      it('reverts', async () => {
        await expect(pool.connect(other).stopAmplificationParameterUpdate()).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    }

    context('with an owner', () => {
      sharedBeforeEach('deploy pool', async () => {
        pool = await deployPool(owner);
        caller = owner;
      });

      context('when the sender is allowed', () => {
        itStopsAnAmpUpdateCorrectly();
      });

      context('when the sender is not allowed', () => {
        itReverts();
      });
    });

    context('with a delegated owner', () => {
      sharedBeforeEach('deploy pool', async () => {
        pool = await deployPool(DELEGATE_OWNER);
        caller = other;
      });

      context('when the sender is allowed', () => {
        sharedBeforeEach('grant permissions', async () => {
          const startAmpChangePermission = await actionId(pool, 'startAmplificationParameterUpdate');
          const stopAmpChangePermission = await actionId(pool, 'stopAmplificationParameterUpdate');
          await vault.grantPermissionGlobally(startAmpChangePermission, other);
          await vault.grantPermissionGlobally(stopAmpChangePermission, other);
        });

        itStopsAnAmpUpdateCorrectly();
      });

      context('when the sender is not allowed', () => {
        itReverts();
      });
    });
  });
});
