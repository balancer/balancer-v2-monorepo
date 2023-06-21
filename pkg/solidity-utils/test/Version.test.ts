import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';

describe('Version', function () {
  describe('constructor', () => {
    it('returns the correct string', async () => {
      const version = await deploy('Version', { args: ['test version string'] });
      expect(await version.version()).to.be.equal('test version string');
    });
  });
});
