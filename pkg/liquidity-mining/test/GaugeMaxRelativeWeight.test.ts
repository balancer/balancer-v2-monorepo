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

describe('GaugeRelativeWeightCap', () => {
  let vault: Vault;
  let gaugeController: Contract;
  let adaptor: Contract;
  let admin: SignerWithAddress, other: SignerWithAddress;
  let BAL: Contract, token0: Contract;

  let liquidityGaugeImplementation: Contract;
  let liquidityGaugeFactory: Contract, stakelessGaugeFactory: Contract;
  let liquidityGauge: Contract, stakelessGauge: Contract;

  let gauge: Contract;

  const defaultRelativeWeightCap = fp(1);

  before('setup signers', async () => {
    [, admin, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy authorizer', async () => {
    vault = await Vault.create({ admin });

    adaptor = await deploy('AuthorizerAdaptor', { args: [vault.address] });
    gaugeController = await deploy('MockGaugeController', { args: [ZERO_ADDRESS, adaptor.address] });

    const gaugeTypeWeight = 0;
    await gaugeController.add_type('Ethereum', gaugeTypeWeight);
  });

  sharedBeforeEach('deploy token mocks', async () => {
    token0 = await deploy('TestBalancerToken', { args: [admin.address, 'Balancer-LP0', 'LP0'] });
    BAL = await deploy('TestBalancerToken', { args: [admin.address, 'Balancer', 'BAL'] });
  });

  sharedBeforeEach('deploy gauge implementation and factory', async () => {
    const balTokenAdmin = await deploy('MockBalancerTokenAdmin', { args: [vault.address, BAL.address] });
    const balMinter = await deploy('BalancerMinter', { args: [balTokenAdmin.address, gaugeController.address] });

    // We won't be using the code that requires the VotingEscrowDelegationProxy so we just use any address, since we
    // must initialize to a non-zero value.
    liquidityGaugeImplementation = await deploy('LiquidityGaugeV5', {
      args: [balMinter.address, ANY_ADDRESS, adaptor.address],
    });
    liquidityGaugeFactory = await deploy('LiquidityGaugeFactory', { args: [liquidityGaugeImplementation.address] });
    // SingleRecipient is the simplest StakelessGauge, so we test with that instead of using e.g. a mock (which would be
    // identical to SingleRecipient)
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
    const action = await actionId(adaptor, 'set_relative_weight_cap', liquidityGaugeImplementation.interface);
    await vault.grantPermissionsGlobally([action], admin);
  });

  async function deployGauge(gaugeFactory: Contract, poolAddress: string, eventName: string): Promise<string> {
    const tx = await gaugeFactory.create(poolAddress, defaultRelativeWeightCap);
    const event = expectEvent.inReceipt(await tx.wait(), eventName);

    return event.args.gauge;
  }

  async function setRelativeWeightCap(relativeWeightCap: BigNumber) {
    const calldata = gauge.interface.encodeFunctionData('set_relative_weight_cap', [relativeWeightCap]);
    return adaptor.connect(admin).performAction(gauge.address, calldata);
  }

  describe('LiquidityGaugeV5', () => {
    beforeEach('use liquidity gauge', () => {
      gauge = liquidityGauge;
    });
    itTestsRelativeWeightCapForGauge();
  });

  describe('StakelessGauge', () => {
    beforeEach('use stakeless gauge', () => {
      gauge = stakelessGauge;
    });
    itTestsRelativeWeightCapForGauge();
  });

  function itTestsRelativeWeightCapForGauge() {
    describe('set_relative_weight_cap', () => {
      const maxRelativeWeightCap = fp(1.0);
      const newRelativeWeightCap = fp(0.3);
      const aboveMaxRelativeWeightCap = maxRelativeWeightCap.add(1);

      context('when the caller is not authorized', () => {
        it('reverts', async () => {
          await expect(gauge.connect(other).set_relative_weight_cap(newRelativeWeightCap)).to.be.reverted;
        });
      });

      context('when the caller is authorized', () => {
        context('within the allowed range', () => {
          it('sets relative weight cap', async () => {
            expect(await gauge.get_relative_weight_cap()).to.be.eq(maxRelativeWeightCap);
            await setRelativeWeightCap(newRelativeWeightCap);
            expect(await gauge.get_relative_weight_cap()).to.be.eq(newRelativeWeightCap);
          });

          it('emits an event', async () => {
            const gaugeRelativeWeightCapChangedInterface = new ethers.utils.Interface([
              'event RelativeWeightCapChanged(uint256 new_relative_weight_cap)',
            ]);
            const tx = await setRelativeWeightCap(newRelativeWeightCap);
            expectEvent.inIndirectReceipt(
              await tx.wait(),
              gaugeRelativeWeightCapChangedInterface,
              'RelativeWeightCapChanged',
              { new_relative_weight_cap: newRelativeWeightCap }
            );
          });
        });

        context('above the allowed range', () => {
          it('reverts', async () => {
            await expect(setRelativeWeightCap(aboveMaxRelativeWeightCap)).to.be.revertedWith(
              'Relative weight cap exceeds allowed absolute maximum'
            );
          });
        });
      });
    });

    describe('get_capped_relative_weight', () => {
      const gaugeControllerWeight = fp(0.7);
      const relativeWeightCapAboveControllerWeight = gaugeControllerWeight.add(1);
      const relativeWeightCapBelowControllerWeight = gaugeControllerWeight.sub(1);
      // The timestamp parameter is being ignored in the mock gauge controller.
      const anyTimestamp = bn(1234);

      context('when the gauge is not added to the gauge controller', () => {
        it('returns 0', async () => {
          expect(await gauge.get_capped_relative_weight(anyTimestamp)).to.be.eq(0);
        });
      });

      context('when the gauge is added to the gauge controller', () => {
        sharedBeforeEach('add gauge to GaugeController', async () => {
          await gaugeController.add_gauge(gauge.address, 0);
          await gaugeController.setGaugeWeight(gauge.address, gaugeControllerWeight);
        });

        const itChecksRelativeWeightCapHasNoEffect = (relativeWeightCap: BigNumber, condition: string) => {
          context(`when the cap is ${condition} the weight`, () => {
            sharedBeforeEach(`set the cap ${condition} the weight`, async () => {
              await setRelativeWeightCap(relativeWeightCap);
              // Verify that the cap is the intended one for this test.
              expect(await gauge.get_relative_weight_cap()).to.be.gte(
                await gaugeController.gauge_relative_weight(gauge.address, anyTimestamp)
              );
            });

            it('returns the same weight as the GaugeController', async () => {
              expect(await gauge.get_capped_relative_weight(anyTimestamp)).to.be.eq(
                await gaugeController.gauge_relative_weight(gauge.address, anyTimestamp)
              );
            });
          });
        };

        context('when cap is above or equal to the weight', () => {
          itChecksRelativeWeightCapHasNoEffect(gaugeControllerWeight, 'equal to');

          itChecksRelativeWeightCapHasNoEffect(relativeWeightCapAboveControllerWeight, 'above');
        });

        context('when the cap is below the weight', () => {
          sharedBeforeEach('set the cap below the weight', async () => {
            await setRelativeWeightCap(relativeWeightCapBelowControllerWeight);
            // Verify that the cap is the intended one for this test.
            expect(await gauge.get_relative_weight_cap()).to.be.lt(
              await gaugeController.gauge_relative_weight(gauge.address, anyTimestamp)
            );
          });

          it('returns relative weight cap', async () => {
            expect(await gauge.get_capped_relative_weight(anyTimestamp)).to.be.eq(
              await gauge.get_relative_weight_cap()
            );
          });
        });
      });
    });

    describe('get_max_relative_weight_cap', () => {
      it('returns 1 normalized to 18 decimals', async () => {
        expect(await gauge.get_max_relative_weight_cap()).to.be.eq(fp(1));
      });
    });
  }
});
