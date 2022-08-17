import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { expect } from 'chai';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { ANY_ADDRESS, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describe('GaugeMaxRelativeWeight', () => {
  let vault: Vault;
  let gaugeController: Contract;
  let adaptor: Contract;
  let admin: SignerWithAddress;
  let BAL: Contract, token0: Contract;

  let liquidityGaugeImplementation: Contract;
  let liquidityGaugeFactory: Contract, stakelessGaugeFactory: Contract;
  let liquidityGauge: Contract, stakelessGauge: Contract;

  let gauge: Contract;

  before('setup signers', async () => {
    [, admin] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy authorizer', async () => {
    vault = await Vault.create({ admin });

    adaptor = await deploy('AuthorizerAdaptor', { args: [vault.address] });
    gaugeController = await deploy('MockGaugeController', { args: [ZERO_ADDRESS, adaptor.address] });

    await gaugeController.add_type('Ethereum', 0);
  });

  sharedBeforeEach('deploy token mocks', async () => {
    token0 = await deploy('TestBalancerToken', { args: [admin.address, 'Balancer-LP0', 'LP0'] });
    BAL = await deploy('TestBalancerToken', { args: [admin.address, 'Balancer', 'BAL'] });
  });

  sharedBeforeEach('deploy gauge implementation and factory', async () => {
    const balTokenAdmin = await deploy('MockBalancerTokenAdmin', { args: [vault.address, BAL.address] });
    const balMinter = await deploy('BalancerMinter', { args: [balTokenAdmin.address, gaugeController.address] });

    // We won't be using the code that requires the VotingEscrowDelegationProxy, so we just use any address.
    liquidityGaugeImplementation = await deploy('LiquidityGaugeV5', {
      args: [balMinter.address, ANY_ADDRESS, adaptor.address],
    });
    liquidityGaugeFactory = await deploy('LiquidityGaugeFactory', { args: [liquidityGaugeImplementation.address] });
    stakelessGaugeFactory = await deploy('SingleRecipientGaugeFactory', { args: [balMinter.address] });
  });

  sharedBeforeEach('deploy gauges', async () => {
    liquidityGauge = await deployedAt(
      'LiquidityGaugeV5',
      await deployGauge(liquidityGaugeFactory, token0.address, 'GaugeCreated')
    );
    stakelessGauge = await deployedAt(
      'SingleRecipientGauge',
      await deployGauge(stakelessGaugeFactory, token0.address, 'SingleRecipientGaugeCreated')
    );
  });

  sharedBeforeEach('set up permissions', async () => {
    const action = await actionId(adaptor, 'set_max_relative_weight', liquidityGaugeImplementation.interface);
    await vault.grantPermissionsGlobally([action], admin);
  });

  async function deployGauge(gaugeFactory: Contract, poolAddress: string, eventName: string): Promise<string> {
    const tx = await gaugeFactory.create(poolAddress);
    const event = expectEvent.inReceipt(await tx.wait(), eventName);

    return event.args.gauge;
  }

  async function setNewMaxRelativeWeight(maxRelativeWeight: BigNumber) {
    const calldata = gauge.interface.encodeFunctionData('set_max_relative_weight', [maxRelativeWeight]);
    return adaptor.connect(admin).performAction(gauge.address, calldata);
  }

  describe('LiquidityGaugeV5', () => {
    beforeEach('use liquidity gauge', () => {
      gauge = liquidityGauge;
    });
    itTestsMaxRelativeWeightForGauge();
  });

  describe('StakelessGauge', () => {
    beforeEach('use stakeless gauge', () => {
      gauge = stakelessGauge;
    });
    itTestsMaxRelativeWeightForGauge();
  });

  function itTestsMaxRelativeWeightForGauge() {
    describe('set_maximum_relative_weight', () => {
      const defaultMaxRelativeWeight = fp(1.0);
      const newMaxRelativeWeight = fp(0.3);
      const aboveAbsoluteMaxRelativeWeight = defaultMaxRelativeWeight.add(1);

      context('without permissions', () => {
        it('reverts', async () => {
          await expect(gauge.set_max_relative_weight(newMaxRelativeWeight)).to.be.reverted;
        });
      });

      context('with permissions', () => {
        context('within the allowed range', () => {
          it('sets max relative weight', async () => {
            expect(await gauge.max_relative_weight()).to.be.eq(defaultMaxRelativeWeight);
            await setNewMaxRelativeWeight(newMaxRelativeWeight);
            expect(await gauge.max_relative_weight()).to.be.eq(newMaxRelativeWeight);
          });

          it('emits an event', async () => {
            const gaugeMaxRelativeWeightChangedInterface = new ethers.utils.Interface([
              'event MaxRelativeWeightChanged(uint256 indexed new_max_relative_weight)',
            ]);
            const tx = await setNewMaxRelativeWeight(newMaxRelativeWeight);
            expectEvent.inIndirectReceipt(
              await tx.wait(),
              gaugeMaxRelativeWeightChangedInterface,
              'MaxRelativeWeightChanged',
              { new_max_relative_weight: newMaxRelativeWeight }
            );
          });
        });

        context('above the allowed range', () => {
          it('reverts', async () => {
            await expect(setNewMaxRelativeWeight(aboveAbsoluteMaxRelativeWeight)).to.be.revertedWith(
              'Max relative weight exceeds allowed absolute maximum'
            );
          });
        });
      });
    });

    describe('get_capped_relative_weight', () => {
      const gaugeControllerWeight = fp(0.7);
      const maxRelativeWeightAboveControllerWeight = gaugeControllerWeight.add(1);
      const maxRelativeWeightBelowControllerWeight = gaugeControllerWeight.sub(1);
      // The timestamp parameter is being ignored in the mock gauge controller.
      const anyTimestamp = bn(1234);

      context('when the gauge is not added to the gauge controller', () => {
        it('returns 0', async () => {
          expect(await gauge.get_capped_relative_weight(anyTimestamp)).to.be.eq(0);
        });
      });

      context('when the gauge is added to the gauge controller', () => {
        sharedBeforeEach('add gauge to GaugeController', async () => {
          await gaugeController.add_gauge_with_weight(gauge.address, 0, gaugeControllerWeight);
        });

        const itChecksMaxRelativeWeightHasNoEffect = (maxRelativeWeightUnderTest: BigNumber, condition: string) => {
          context(`when max relative weight ${condition} gauge controller relative weight for the gauge`, () => {
            let uncappedRelativeWeight: BigNumber;
            sharedBeforeEach(
              `set gauge max relative weight ${condition} gauge controller relative weight for the gauge`,
              async () => {
                await setNewMaxRelativeWeight(maxRelativeWeightUnderTest);
                uncappedRelativeWeight = await gaugeController.gauge_relative_weight(gauge.address, anyTimestamp);
              }
            );

            it('verifies that max relative weight >= gauge controller relative weight for the gauge', async () => {
              expect(await gauge.max_relative_weight()).to.be.gte(uncappedRelativeWeight);
            });

            it('returns the same weight as the GaugeController', async () => {
              expect(await gauge.get_capped_relative_weight(anyTimestamp)).to.be.eq(uncappedRelativeWeight);
            });
          });
        };

        context('when max relative weight >= gauge controller relative weight for the gauge', () => {
          itChecksMaxRelativeWeightHasNoEffect(gaugeControllerWeight, '==');

          itChecksMaxRelativeWeightHasNoEffect(maxRelativeWeightAboveControllerWeight, '>');
        });

        context('when gauge max relative weight < gauge controller relative weight', () => {
          let maxRelativeWeight: BigNumber;
          sharedBeforeEach('set max relative weight below gauge controller relative weight for the gauge', async () => {
            await setNewMaxRelativeWeight(maxRelativeWeightBelowControllerWeight);
            maxRelativeWeight = await gauge.max_relative_weight();
          });

          it('verifies that max relative weight < gauge controller relative weight for the gauge', async () => {
            expect(maxRelativeWeight).to.be.lt(
              await gaugeController.gauge_relative_weight(gauge.address, anyTimestamp)
            );
          });

          it('returns max relative weight', async () => {
            expect(await gauge.get_capped_relative_weight(anyTimestamp)).to.be.eq(maxRelativeWeight);
          });
        });
      });
    });

    describe('get_absolute_max_relative_weight', () => {
      it('returns 1 normalized to 18 decimals', async () => {
        expect(await gauge.get_absolute_max_relative_weight()).to.be.eq(fp(1));
      });
    });
  }
});
