import { expect } from 'chai';

import Task from '../../../src/task';
import { Output } from '../../../src/types';

describe('PrimaryIssuePoolFactory', function () {
  const task = Task.forTest('20220415-primary-issue-pool', 'ropsten');

  context('with no previous deploy', () => {
    const itDeploysFactory = (force: boolean) => {
      it('deploys a primary issue pool factory', async () => {
        await task.run({ force });

        const output = task.output();
        expect(output.PrimaryIssuePoolFactory).not.to.be.null;
        expect(output.timestamp).not.to.be.null;

        const input = task.input();
        const factory = await task.deployedInstance('PrimaryIssuePoolFactory');
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

      it('re-deploys the primary issue pool factory', async () => {
        await task.run({ force });

        const output = task.output();
        expect(output.PrimaryIssuePoolFactory).not.to.be.equal(previousDeploy.PrimaryIssuePoolFactory);
        expect(output.timestamp).to.be.gt(previousDeploy.timestamp);
      });
    });

    context('when not forced', () => {
      const force = false;

      it('does not re-deploys the primary issue pool factory', async () => {
        await task.run({ force });

        const output = task.output();
        expect(output.PrimaryIssuePoolFactory).to.be.equal(previousDeploy.PrimaryIssuePoolFactory);
        expect(output.timestamp).to.be.equal(previousDeploy.timestamp);
      });
    });
  });
});
