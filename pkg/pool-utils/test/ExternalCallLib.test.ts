import { Contract, ContractTransaction } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';
import { solidityKeccak256 } from 'ethers/lib/utils';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

enum RevertType {
  DoNotRevert,
  NonMalicious,
  MaliciousSwapQuery,
  MaliciousJoinExitQuery,
}

describe('ExternalCallLib', function () {
  let maliciousReverter: Contract;
  let caller: Contract;

  sharedBeforeEach(async function () {
    maliciousReverter = await deploy('MaliciousQueryReverter');
    caller = await deploy('MockExternalCaller', { args: [maliciousReverter.address] });
  });

  async function getRevertDataSelector(contractCall: () => Promise<ContractTransaction>): Promise<string | null> {
    try {
      const tx = await contractCall();
      await tx.wait();

      return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      const revertData = e.data;

      return revertData.slice(0, 10);
    }
  }

  function itCatchesTheMaliciousRevert(contractCall: () => Promise<ContractTransaction>) {
    it('reverts with MALICIOUS_QUERY_REVERT', async () => {
      await expect(contractCall()).to.be.revertedWith('MALICIOUS_QUERY_REVERT');
    });
  }

  function itBubblesUpTheRevertReason(contractCall: () => Promise<ContractTransaction>, error_string: string) {
    it('bubbles up original revert data', async () => {
      await expect(contractCall()).to.be.revertedWith(error_string);
    });
  }

  // We separate the malicious case as the standard matcher doesn't handle custom errors well.
  function itBubblesUpTheMaliciousRevertReason(
    contractCall: () => Promise<ContractTransaction>,
    expectedRevertSelector: string
  ) {
    it('bubbles up original revert data', async () => {
      const revertDataSelector = await getRevertDataSelector(contractCall);

      expect(revertDataSelector).to.be.eq(expectedRevertSelector);
    });
  }

  describe('when an external call in a swap query reverts', () => {
    const queryErrorSignature = solidityKeccak256(['string'], ['QueryError(int256[])']).slice(0, 10);

    context('when revert data is malicious', () => {
      sharedBeforeEach(async () => {
        await maliciousReverter.setRevertType(RevertType.MaliciousSwapQuery);
      });

      context('when call is protected', () => {
        itCatchesTheMaliciousRevert(() => caller.protectedExternalCall());
      });

      context('when call is unprotected', () => {
        itBubblesUpTheMaliciousRevertReason(() => caller.unprotectedExternalCall(), queryErrorSignature);
      });
    });

    context('when revert data is non-malicious', () => {
      sharedBeforeEach(async () => {
        await maliciousReverter.setRevertType(RevertType.NonMalicious);
      });

      context('when call is protected', () => {
        itBubblesUpTheRevertReason(() => caller.protectedExternalCall(), 'NON_MALICIOUS_REVERT');
      });

      context('when call is unprotected', () => {
        itBubblesUpTheRevertReason(() => caller.unprotectedExternalCall(), 'NON_MALICIOUS_REVERT');
      });
    });
  });

  describe('when an external call in a join/exit query reverts', () => {
    const queryErrorSignature = solidityKeccak256(['string'], ['QueryError(uint256,uint256[])']).slice(0, 10);

    context('when revert data is malicious', () => {
      sharedBeforeEach(async () => {
        await maliciousReverter.setRevertType(RevertType.MaliciousJoinExitQuery);
      });

      context('when call is protected', () => {
        itCatchesTheMaliciousRevert(() => caller.protectedExternalCall());
      });

      context('when call is unprotected', () => {
        itBubblesUpTheMaliciousRevertReason(() => caller.unprotectedExternalCall(), queryErrorSignature);
      });
    });

    context('when revert data is non-malicious', () => {
      sharedBeforeEach(async () => {
        await maliciousReverter.setRevertType(RevertType.NonMalicious);
      });

      context('when call is protected', () => {
        itBubblesUpTheRevertReason(() => caller.protectedExternalCall(), 'NON_MALICIOUS_REVERT');
      });

      context('when call is unprotected', () => {
        itBubblesUpTheRevertReason(() => caller.unprotectedExternalCall(), 'NON_MALICIOUS_REVERT');
      });
    });
  });
});
