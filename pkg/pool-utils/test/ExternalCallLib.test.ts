import { Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';
import { solidityKeccak256 } from 'ethers/lib/utils';

describe('ExternalCallLib', function () {
  let maliciousReverter: Contract;
  let caller: Contract;

  sharedBeforeEach(async function () {
    maliciousReverter = await deploy('MaliciousQueryReverter');
    caller = await deploy('MockExternalCaller', { args: [maliciousReverter.address] });
  });

  describe('making external call to a malicious contract', () => {
    context('when call is protected', () => {
      it('reverts with MALICIOUS_QUERY_REVERT', async () => {
        await expect(caller.protectedExternalCall()).to.be.revertedWith('MALICIOUS_QUERY_REVERT');
      });
    });

    context('when call is unprotected', () => {
      it('bubbles up original revert data', async () => {
        const maliciousErrorSignature = solidityKeccak256(['string'], ['QueryError(uint256,uint256[])']).slice(0, 10);

        try {
          const tx = await caller.unprotectedExternalCall();
          await tx.wait();
        } catch (e: any) {
          const revertData = e.data;

          expect(revertData.slice(0, 10)).to.be.eq(maliciousErrorSignature);
        }
      });
    });
  });
});
