import { expect } from 'chai';
import { Contract } from 'ethers';
import { Interface } from 'ethers/lib/utils';

import { deploy, getArtifact } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describe('ManagedPool owner only actions', () => {
  let pool: Contract;

  sharedBeforeEach('deploy pool', async () => {
    const vault = await Vault.create();
    const tokens = await TokenList.create(2, { sorted: true });
    pool = await deploy('MockManagedPool', {
      args: [
        {
          name: '',
          symbol: '',
          tokens: tokens.addresses,
          normalizedWeights: [fp(0.5), fp(0.5)],
          assetManagers: new Array(2).fill(ZERO_ADDRESS),
          swapFeePercentage: fp(0.05),
          swapEnabledOnStart: true,
          mustAllowlistLPs: false,
          managementAumFeePercentage: fp(0),
        },
        vault.address,
        vault.getFeesProvider().address,
        ZERO_ADDRESS,
        0,
        0,
      ],
    });
  });

  function itIsOwnerOnly(method: string) {
    it(`${method} requires the caller to be the owner`, async () => {
      expect(await pool.isOwnerOnlyAction(await actionId(pool, method))).to.be.true;
    });
  }

  function itIsNotOwnerOnly(method: string) {
    it(`${method} doesn't require the caller to be the owner`, async () => {
      expect(await pool.isOwnerOnlyAction(await actionId(pool, method))).to.be.false;
    });
  }

  const poolArtifact = getArtifact('v2-pool-weighted/ManagedPool');
  const poolInterface = new Interface(poolArtifact.abi);
  const nonViewFunctions = Object.entries(poolInterface.functions)
    .filter(
      ([, elem]) =>
        elem.type === 'function' && (elem.stateMutability === 'payable' || elem.stateMutability === 'nonpayable')
    )
    .map(([signature]) => signature);

  const expectedOwnerOnlyFunctions = [
    'addAllowedAddress(address)',
    'addToken(address,address,uint256,uint256,address)',
    'removeAllowedAddress(address)',
    'removeToken(address,uint256,address)',
    'setManagementAumFeePercentage(uint256)',
    'setMustAllowlistLPs(bool)',
    'setSwapEnabled(bool)',
    'setSwapFeePercentage(uint256)',
    'updateSwapFeeGradually(uint256,uint256,uint256,uint256)',
    'updateWeightsGradually(uint256,uint256,uint256[])',
  ];

  const expectedNotOwnerOnlyFunctions = nonViewFunctions.filter((fn) => !expectedOwnerOnlyFunctions.includes(fn));

  describe('owner only actions', () => {
    for (const expectedOwnerOnlyFunction of expectedOwnerOnlyFunctions) {
      itIsOwnerOnly(expectedOwnerOnlyFunction);
    }
  });

  describe('non owner only actions', () => {
    for (const expectedNotOwnerOnlyFunction of expectedNotOwnerOnlyFunctions) {
      itIsNotOwnerOnly(expectedNotOwnerOnlyFunction);
    }
  });
});
