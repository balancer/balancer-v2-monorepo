import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';

import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { bn } from '@balancer-labs/v2-helpers/src/numbers';
import {
  advanceTime,
  advanceToTimestamp,
  currentTimestamp,
  DAY,
  setNextBlockTimestamp,
} from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';

describe('StablePoolAmplification', () => {
  let owner: SignerWithAddress, admin: SignerWithAddress, other: SignerWithAddress;
  let pool: Contract;

  const AMP_PRECISION = 1e3;
  const AMPLIFICATION_PARAMETER = bn(200);

  sharedBeforeEach('setup signers', async () => {
    [, admin, owner, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy pool', async () => {
    const vault = await Vault.create({ admin });
    pool = await deploy('MockStablePoolAmplification', {
      args: [vault.address, owner.address, AMPLIFICATION_PARAMETER],
    });
  });

  describe('startAmplificationParameterUpdate', () => {
    context('when the sender is allowed', () => {
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
            const increasing = AMPLIFICATION_PARAMETER.lt(newAmp);

            context('when there is no ongoing update', () => {
              it('starts changing the amp', async () => {
                await pool.connect(owner).startAmplificationParameterUpdate(newAmp, endTime);

                await advanceTime(duration / 2);

                const { value, isUpdating } = await pool.getAmplificationParameter();
                expect(isUpdating).to.be.true;

                if (increasing) {
                  const diff = newAmp.sub(AMPLIFICATION_PARAMETER).mul(AMP_PRECISION);
                  expect(value).to.be.equalWithError(
                    AMPLIFICATION_PARAMETER.mul(AMP_PRECISION).add(diff.div(2)),
                    0.00001
                  );
                } else {
                  const diff = AMPLIFICATION_PARAMETER.sub(newAmp).mul(AMP_PRECISION);
                  expect(value).to.be.equalWithError(
                    AMPLIFICATION_PARAMETER.mul(AMP_PRECISION).sub(diff.div(2)),
                    0.00001
                  );
                }
              });

              it('stops updating after duration', async () => {
                await pool.connect(owner).startAmplificationParameterUpdate(newAmp, endTime);

                await advanceTime(duration + 1);

                const { value, isUpdating } = await pool.getAmplificationParameter();
                expect(value).to.be.equal(newAmp.mul(AMP_PRECISION));
                expect(isUpdating).to.be.false;
              });

              it('emits an AmpUpdateStarted event', async () => {
                const receipt = await pool.connect(owner).startAmplificationParameterUpdate(newAmp, endTime);

                expectEvent.inReceipt(await receipt.wait(), 'AmpUpdateStarted', {
                  startValue: AMPLIFICATION_PARAMETER.mul(AMP_PRECISION),
                  endValue: newAmp.mul(AMP_PRECISION),
                  endTime,
                });
              });

              it('does not emit an AmpUpdateStopped event', async () => {
                const receipt = await pool.connect(owner).startAmplificationParameterUpdate(newAmp, endTime);
                expectEvent.notEmitted(await receipt.wait(), 'AmpUpdateStopped');
              });
            });

            context('when there is an ongoing update', () => {
              sharedBeforeEach('start change', async () => {
                await pool.connect(owner).startAmplificationParameterUpdate(newAmp, endTime);

                await advanceTime(duration / 3);
                const beforeStop = await pool.getAmplificationParameter();
                expect(beforeStop.isUpdating).to.be.true;
              });

              it('trying to start another update reverts', async () => {
                await expect(pool.connect(owner).startAmplificationParameterUpdate(newAmp, endTime)).to.be.revertedWith(
                  'AMP_ONGOING_UPDATE'
                );
              });

              context('after the ongoing update is stopped', () => {
                let ampValueAfterStop: BigNumber;

                sharedBeforeEach('stop change', async () => {
                  await pool.connect(owner).stopAmplificationParameterUpdate();
                  const ampState = await pool.getAmplificationParameter();
                  ampValueAfterStop = ampState.value;
                });

                it('the new update can be started', async () => {
                  const newEndTime = (await currentTimestamp()).add(DAY * 2);
                  const startReceipt = await pool.connect(owner).startAmplificationParameterUpdate(newAmp, newEndTime);
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
              const newAmp = AMPLIFICATION_PARAMETER.mul(2);

              itUpdatesAmpCorrectly(newAmp);
            });
          });

          context('when decreasing the amp', () => {
            context('when decreasing the amp by 2x', () => {
              const newAmp = AMPLIFICATION_PARAMETER.div(2);

              itUpdatesAmpCorrectly(newAmp);
            });
          });
        });

        context('when requesting an invalid amp', () => {
          it('reverts when requesting below the min', async () => {
            const lowAmp = bn(0);
            await expect(pool.connect(owner).startAmplificationParameterUpdate(lowAmp, endTime)).to.be.revertedWith(
              'MIN_AMP'
            );
          });

          it('reverts when requesting above the max', async () => {
            const highAmp = bn(5001);
            await expect(pool.connect(owner).startAmplificationParameterUpdate(highAmp, endTime)).to.be.revertedWith(
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
              const newAmp = AMPLIFICATION_PARAMETER.mul(2).add(1);
              const endTime = startTime.add(DAY);

              await expect(pool.connect(owner).startAmplificationParameterUpdate(newAmp, endTime)).to.be.revertedWith(
                'AMP_RATE_TOO_HIGH'
              );
            });

            it('reverts when increasing the amp by more than 2x daily over multiple days', async () => {
              const newAmp = AMPLIFICATION_PARAMETER.mul(5).add(1);
              const endTime = startTime.add(DAY * 2);

              await expect(pool.connect(owner).startAmplificationParameterUpdate(newAmp, endTime)).to.be.revertedWith(
                'AMP_RATE_TOO_HIGH'
              );
            });

            it('reverts when decreasing the amp by more than 2x in a single day', async () => {
              const newAmp = AMPLIFICATION_PARAMETER.div(2).sub(1);
              const endTime = startTime.add(DAY);

              await expect(pool.connect(owner).startAmplificationParameterUpdate(newAmp, endTime)).to.be.revertedWith(
                'AMP_RATE_TOO_HIGH'
              );
            });

            it('reverts when decreasing the amp by more than 2x daily over multiple days', async () => {
              const newAmp = AMPLIFICATION_PARAMETER.div(5).sub(1);
              const endTime = startTime.add(DAY * 2);

              await expect(pool.connect(owner).startAmplificationParameterUpdate(newAmp, endTime)).to.be.revertedWith(
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
            pool.connect(owner).startAmplificationParameterUpdate(AMPLIFICATION_PARAMETER, endTime)
          ).to.be.revertedWith('AMP_END_TIME_TOO_CLOSE');
        });
      });
    });

    context('when the sender is not allowed', () => {
      it('reverts', async () => {
        await expect(pool.connect(other).stopAmplificationParameterUpdate()).to.be.revertedWith('SENDER_NOT_ALLOWED');
        await expect(
          pool.connect(other).startAmplificationParameterUpdate(AMPLIFICATION_PARAMETER, DAY)
        ).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });
  });

  describe('stopAmplificationParameterUpdate', () => {
    context('when the sender is allowed', () => {
      context('when there is an ongoing update', () => {
        sharedBeforeEach('start change', async () => {
          const newAmp = AMPLIFICATION_PARAMETER.mul(2);
          const duration = DAY * 2;

          const startTime = (await currentTimestamp()).add(100);
          await setNextBlockTimestamp(startTime);
          const endTime = startTime.add(duration);

          await pool.connect(owner).startAmplificationParameterUpdate(newAmp, endTime);

          await advanceTime(duration / 3);
          const beforeStop = await pool.getAmplificationParameter();
          expect(beforeStop.isUpdating).to.be.true;
        });

        it('stops the amp factor from updating', async () => {
          const beforeStop = await pool.getAmplificationParameter();

          await pool.connect(owner).stopAmplificationParameterUpdate();

          const afterStop = await pool.getAmplificationParameter();
          expect(afterStop.value).to.be.equalWithError(beforeStop.value, 0.001);
          expect(afterStop.isUpdating).to.be.false;

          await advanceTime(30 * DAY);

          const muchLaterAfterStop = await pool.getAmplificationParameter();
          expect(muchLaterAfterStop.value).to.be.equal(afterStop.value);
          expect(muchLaterAfterStop.isUpdating).to.be.false;
        });

        it('emits an AmpUpdateStopped event', async () => {
          const receipt = await pool.connect(owner).stopAmplificationParameterUpdate();
          expectEvent.inReceipt(await receipt.wait(), 'AmpUpdateStopped');
        });

        it('does not emit an AmpUpdateStarted event', async () => {
          const receipt = await pool.connect(owner).stopAmplificationParameterUpdate();
          expectEvent.notEmitted(await receipt.wait(), 'AmpUpdateStarted');
        });
      });

      context('when there is no ongoing update', () => {
        it('reverts', async () => {
          await expect(pool.connect(owner).stopAmplificationParameterUpdate()).to.be.revertedWith(
            'AMP_NO_ONGOING_UPDATE'
          );
        });
      });
    });

    context('when the sender is not allowed', () => {
      it('reverts', async () => {
        await expect(pool.connect(other).stopAmplificationParameterUpdate()).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });
  });
});
