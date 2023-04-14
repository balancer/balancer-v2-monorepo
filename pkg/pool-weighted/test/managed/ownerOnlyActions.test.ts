import { expect } from 'chai';
import { Contract } from 'ethers';
import { Interface } from 'ethers/lib/utils';

import { deploy, getArtifact } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { ProtocolFee } from '@balancer-labs/v2-helpers/src/models/vault/types';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('ManagedPool owner only actions', () => {
  let pool: Contract;

  sharedBeforeEach('deploy pool', async () => {
    const vault = await Vault.create();
    const tokens = await TokenList.create(2, { sorted: true });
    const addRemoveTokenLib = await deploy('ManagedPoolAddRemoveTokenLib');
    const math = await deploy('ExternalWeightedMath');
    const recoveryModeHelper = await deploy('v2-pool-utils/RecoveryModeHelper', { args: [vault.address] });
    const circuitBreakerLib = await deploy('CircuitBreakerLib');
    const ammLib = await deploy('v2-pool-weighted/ManagedPoolAmmLib', {
      libraries: {
        CircuitBreakerLib: circuitBreakerLib.address,
      },
    });

    pool = await deploy('MockManagedPool', {
      args: [
        { name: '', symbol: '', assetManagers: new Array(2).fill(ZERO_ADDRESS) },
        {
          vault: vault.address,
          protocolFeeProvider: vault.getFeesProvider().address,
          weightedMath: math.address,
          recoveryModeHelper: recoveryModeHelper.address,
          pauseWindowDuration: 0,
          bufferPeriodDuration: 0,
          version: '',
        },
        {
          tokens: tokens.addresses,
          normalizedWeights: [fp(0.5), fp(0.5)],
          swapFeePercentage: fp(0.05),
          swapEnabledOnStart: true,
          mustAllowlistLPs: false,
          managementAumFeePercentage: fp(0),
          aumFeeId: ProtocolFee.AUM,
        },
        ZERO_ADDRESS,
      ],
      libraries: {
        CircuitBreakerLib: circuitBreakerLib.address,
        ManagedPoolAddRemoveTokenLib: addRemoveTokenLib.address,
        ManagedPoolAmmLib: ammLib.address,
      },
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
    'setJoinExitEnabled(bool)',
    'setSwapEnabled(bool)',
    'updateSwapFeeGradually(uint256,uint256,uint256,uint256)',
    'updateWeightsGradually(uint256,uint256,address[],uint256[])',
    'setCircuitBreakers(address[],uint256[],uint256[],uint256[])',
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
