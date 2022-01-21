import { expect } from 'chai';

import Task from '../../../src/task';
import { Output } from '../../../src/types';

describe('StablePoolFactory', function () {
  const task = Task.forTest('20210624-stable-pool', 'mainnet');

  context('with no previous deploy', () => {
    const itDeploysFactory = (force: boolean) => {
      it('deploys a stable pool factory', async () => {
        await task.run({ force });

        const output = task.output();
        expect(output.StablePoolFactory).not.to.be.null;
        expect(output.timestamp).not.to.be.null;

        const input = task.input();
        const factory = await task.deployedInstance('StablePoolFactory');
        expect(await factory.getVault()).to.be.equal(input.Vault);
      });
    };

    context('when forced', () => {
      const force = true;

      itDeploysFactory(force);
    });

    context('when not forced', () => {
      const force = false;

      itDeploysFactory(force);
    });
  });

  context('with a previous deploy', () => {
    let previousDeploy: Output;

    beforeEach('deploy', async () => {
      await task.run();
      previousDeploy = task.output();
    });

    context('when forced', () => {
      const force = true;

      it('re-deploys the stable pool factory', async () => {
        await task.run({ force });

        const output = task.output();
        expect(output.StablePoolFactory).not.to.be.equal(previousDeploy.StablePoolFactory);
        expect(output.timestamp).to.be.gt(previousDeploy.timestamp);
      });
    });

    context('when not forced', () => {
      const force = false;

      it('does not re-deploys the stable pool factory', async () => {
        await task.run({ force });

        const output = task.output();
        expect(output.StablePoolFactory).to.be.equal(previousDeploy.StablePoolFactory);
        expect(output.timestamp).to.be.equal(previousDeploy.timestamp);
      });
    });
  });
});
