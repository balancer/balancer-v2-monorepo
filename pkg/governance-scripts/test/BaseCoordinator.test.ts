import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { expect } from 'chai';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { advanceTime, DAY, receiptTimestamp } from '@balancer-labs/v2-helpers/src/time';

const NUM_STAGES = 4;

describe('BaseCoordinator', () => {
  let vault: Vault;
  let adaptor: Contract;

  let coordinator: Contract;

  let admin: SignerWithAddress;

  before('setup signers', async () => {
    [, admin] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault', async () => {
    vault = await Vault.create({ admin });
    if (!vault.authorizer) throw Error('Vault has no Authorizer');

    adaptor = await deploy('v2-liquidity-mining/AuthorizerAdaptor', { args: [vault.address] });
  });

  sharedBeforeEach('deploy coordinator', async () => {
    coordinator = await deploy('TestCoordinator', { args: [adaptor.address] });
  });

  describe('registerStages', () => {
    context('when stages have not already been registered', () => {
      it('emits a RegisterStagesHookCalled event', async () => {
        const tx = await coordinator.registerStages();

        expectEvent.inReceipt(await tx.wait(), 'RegisterStagesHookCalled');
      });
    });

    context('when stages have already been registered', () => {
      sharedBeforeEach('register stages', async () => {
        await coordinator.registerStages();
      });

      it('reverts', async () => {
        await expect(coordinator.registerStages()).to.be.revertedWith('Coordinator stages already registered');
      });
    });
  });

  describe('getStagesLength', () => {
    context('on deployment', () => {
      it('returns zero', async () => {
        expect(await coordinator.getStagesLength()).to.be.eq(0);
      });
    });

    context('after stages are registered', () => {
      sharedBeforeEach('register stages', async () => {
        await coordinator.registerStages();
      });

      it('returns the number of stages registered', async () => {
        expect(await coordinator.getStagesLength()).to.be.eq(NUM_STAGES);
      });
    });
  });

  describe('_getTimeSinceLastStageActivation', () => {
    context('when the first stage has not been executed yet', () => {
      it('reverts', async () => {
        await expect(coordinator.getTimeSinceLastStageActivation()).to.be.revertedWith(
          'First stage has not yet been activated'
        );
      });
    });

    context('when the first stage has been executed', () => {
      sharedBeforeEach('execute first stage', async () => {
        await coordinator.performNextStage();
      });

      const executionDelays = [DAY, 2 * DAY, 4.5 * DAY, 50 * DAY];

      it('returns the time passed since the last stage was executed', async () => {
        await advanceTime(executionDelays[0]);
        expect(await coordinator.getTimeSinceLastStageActivation()).to.be.almostEqual(executionDelays[0]);

        for (let i = 1; i < NUM_STAGES; i++) {
          await coordinator.performNextStage();
          await advanceTime(executionDelays[i]);
          expect(await coordinator.getTimeSinceLastStageActivation()).to.be.almostEqual(executionDelays[i]);
        }
      });
    });
  });

  describe('performNextStage', () => {
    function itExecutesTheStageCorrectly(stageIndex: number, lastStage: boolean) {
      if (stageIndex === 0) {
        context('when the stages have not been registered', () => {
          it('registers the stages automatically', async () => {
            const tx = await coordinator.performNextStage();

            expectEvent.inReceipt(await tx.wait(), 'RegisterStagesHookCalled');
          });
        });

        context('when the stages have been registered manually', () => {
          sharedBeforeEach('register stages', async () => {
            await coordinator.registerStages();
          });

          it('proceeds without attempting to register them', async () => {
            const tx = await coordinator.performNextStage();

            expectEvent.notEmitted(await tx.wait(), 'RegisterStagesHookCalled');
          });
        });
      }

      it('executes the stage', async () => {
        const tx = await coordinator.performNextStage();
        await expectEvent.inReceipt(await tx.wait(), 'StagePerformed', { stageNumber: stageIndex + 1 });
      });

      it('saves the timestamp at which it was executed', async () => {
        await expect(coordinator.getStageActivationTime(stageIndex)).to.be.reverted;
        const tx = await coordinator.performNextStage();
        expect(await coordinator.getStageActivationTime(stageIndex)).to.be.eq(await receiptTimestamp(tx.wait()));
      });

      it('increments the current stage', async () => {
        expect(await coordinator.getCurrentStage()).to.be.eq(stageIndex);
        await coordinator.performNextStage();
        expect(await coordinator.getCurrentStage()).to.be.eq(stageIndex + 1);
      });

      if (stageIndex > 0) {
        // This test does not apply to the first stage as it may register the stages.
        it('does not affect the number of stages registered', async () => {
          expect(await coordinator.getStagesLength()).to.be.eq(NUM_STAGES);
          await coordinator.performNextStage();
          expect(await coordinator.getStagesLength()).to.be.eq(NUM_STAGES);
        });
      }

      if (lastStage) {
        it('runs the _afterLastStage hook', async () => {
          const tx = await coordinator.performNextStage();
          await expectEvent.inReceipt(await tx.wait(), 'AfterLastStageHookExecuted');
        });

        it('marks the coordinator as completed', async () => {
          expect(await coordinator.isComplete()).to.be.false;
          await coordinator.performNextStage();
          expect(await coordinator.isComplete()).to.be.true;
        });
      } else {
        it('does not run the _afterLastStage hook', async () => {
          const tx = await coordinator.performNextStage();
          await expectEvent.notEmitted(await tx.wait(), 'AfterLastStageHookExecuted');
        });

        it('does not mark the coordinator as completed', async () => {
          expect(await coordinator.isComplete()).to.be.false;
          await coordinator.performNextStage();
          expect(await coordinator.isComplete()).to.be.false;
        });
      }
    }

    for (let i = 0; i < NUM_STAGES; i++) {
      const isLastStage = i === NUM_STAGES - 1;

      context(`when executing the ${isLastStage ? 'last' : `${i + 1}th`} stage`, () => {
        sharedBeforeEach('execute previous stages', async () => {
          for (let j = 0; j < i; j++) {
            await coordinator.performNextStage();
          }
        });

        itExecutesTheStageCorrectly(i, isLastStage);
      });
    }

    context('when all stages have been executed', () => {
      sharedBeforeEach('execute all stages', async () => {
        for (let i = 0; i < NUM_STAGES; i++) {
          await coordinator.performNextStage();
        }
      });

      it('reverts', async () => {
        await expect(coordinator.performNextStage()).to.be.revertedWith('All stages completed');
      });
    });
  });
});
