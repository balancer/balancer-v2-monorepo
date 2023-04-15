import hre from 'hardhat';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { impersonate, getForkedNetwork, Task, TaskMode, describeForkTest } from '../../../src';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

describeForkTest('AuthorizerWithAdaptorValidation', 'mainnet', 17047707, function () {
  let admin: SignerWithAddress;
  let govMultisig: SignerWithAddress, lmMultisig: SignerWithAddress, swapFeeSetter: SignerWithAddress;
  let authorizer: Contract,
    vault: Contract,
    actualAuthorizer: Contract,
    authorizerAdaptor: Contract,
    adaptorEntrypoint: Contract,
    gaugeAdder;

  let task: Task;
  let addEthereumGaugeAction: string;

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';
  const LM_MULTISIG = '0xc38c5f97b34e175ffd35407fc91a937300e33860';
  const SWAP_FEE_SETTER = '0xE4a8ed6c1D8d048bD29A00946BFcf2DB10E7923B';

  before('run task', async () => {
    task = new Task('20230414-authorizer-wrapper', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    authorizer = await task.deployedInstance('AuthorizerWithAdaptorValidation');
  });

  before('load signers', async () => {
    [, admin] = await ethers.getSigners();

    govMultisig = await impersonate(GOV_MULTISIG, fp(1000));
    lmMultisig = await impersonate(LM_MULTISIG, fp(100));
    swapFeeSetter = await impersonate(SWAP_FEE_SETTER, fp(100));
  });

  before('setup contracts', async () => {
    vault = await new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre)).deployedInstance('Vault');
    actualAuthorizer = await new Task(
      '20210418-authorizer',
      TaskMode.READ_ONLY,
      getForkedNetwork(hre)
    ).deployedInstance('Authorizer');

    authorizerAdaptor = await new Task(
      '20220325-authorizer-adaptor',
      TaskMode.READ_ONLY,
      getForkedNetwork(hre)
    ).deployedInstance('AuthorizerAdaptor');

    adaptorEntrypoint = await new Task(
      '20221124-authorizer-adaptor-entrypoint',
      TaskMode.READ_ONLY,
      getForkedNetwork(hre)
    ).deployedInstance('AuthorizerAdaptorEntrypoint');

    gaugeAdder = await new Task('20230109-gauge-adder-v3', TaskMode.READ_ONLY, getForkedNetwork(hre)).deployedInstance(
      'GaugeAdder'
    );
  });

  before('get actions', async () => {
    addEthereumGaugeAction = await actionId(gaugeAdder, 'addEthereumGauge');
  });

  describe('getters', () => {
    it('stores the actual (existing basic) authorizer', async () => {
      expect(await authorizer.getActualAuthorizer()).to.eq(actualAuthorizer.address);
    });

    it('stores the authorizer adaptor', async () => {
      expect(await authorizer.getAuthorizerAdaptor()).to.eq(authorizerAdaptor.address);
    });

    it('stores the authorizer adaptor entrypoint', async () => {
      expect(await authorizer.getAuthorizerAdaptorEntrypoint()).to.equal(adaptorEntrypoint.address);
    });

    it('configures the gauge adder', async () => {
      const entrypoint = await gaugeAdder.getAuthorizerAdaptorEntrypoint();
      const gaugeAdderAuthorizer = await adaptorEntrypoint.getAuthorizer();

      // Ensure the authorizer we just set the permissions on is the same one the gauge adder is using
      expect(entrypoint).to.equal(adaptorEntrypoint.address);
      expect(gaugeAdderAuthorizer).to.equal(actualAuthorizer.address);
    });
  });

  describe('Gauge Adder v3', () => {
    let gauge: string;

    sharedBeforeEach(async () => {
      const factoryTask = new Task('20220822-mainnet-gauge-factory-v2', TaskMode.READ_ONLY, getForkedNetwork(hre));
      const gaugeFactory = await factoryTask.deployedInstance('LiquidityGaugeFactory');

      const pool = '0x32296969ef14eb0c6d29669c550d4a0449130230';
      const tx = await gaugeFactory.create(pool, 0);
      const event = expectEvent.inIndirectReceipt(await tx.wait(), gaugeFactory.interface, 'GaugeCreated');
      gauge = event.args.gauge;
    });

    context('before the upgrade', () => {
      it('the LM multisig has permission to add gauges', async () => {
        expect(await actualAuthorizer.canPerform(addEthereumGaugeAction, lmMultisig.address, ZERO_ADDRESS)).to.be.true;
      });

      it('attempting to add gauges reverts as the Adaptor Entrypoint is not yet operational', async () => {
        await expect(gaugeAdder.connect(lmMultisig).addEthereumGauge(gauge)).to.be.revertedWith('BAL#401');
      });
    });

    context('after the upgrade', () => {
      sharedBeforeEach('upgrade Authorizer', async () => {
        const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
        await actualAuthorizer.connect(govMultisig).grantRole(setAuthorizerAction, admin.address);

        await vault.connect(admin).setAuthorizer(authorizer.address);
        expect(await vault.getAuthorizer()).to.equal(authorizer.address);
      });

      it('GaugeAdder can now add gauges', async () => {
        const tx = await gaugeAdder.connect(lmMultisig).addEthereumGauge(gauge);

        const gaugeControllerInterface = new ethers.utils.Interface([
          'event NewGauge(address gauge, int128 gaugeType, uint256 weight)',
        ]);

        expectEvent.inIndirectReceipt(await tx.wait(), gaugeControllerInterface, 'NewGauge', {
          gauge,
        });
      });
    });
  });

  describe('set swap fee percentage', () => {
    let pool: Contract;

    sharedBeforeEach(async () => {
      const factoryTask = new Task('20230206-weighted-pool-v3', TaskMode.READ_ONLY, getForkedNetwork(hre));
      pool = await factoryTask.instanceAt('WeightedPool', '0xEab8B160903B4a29D7D92C92b4ff632F5c964987');
    });

    context('before the upgrade', () => {
      it('the swap fee percentage can be set', async () => {
        const tx = await pool.connect(swapFeeSetter).setSwapFeePercentage(fp(0.1));
        expectEvent.inReceipt(await tx.wait(), 'SwapFeePercentageChanged');
      });
    });

    context('after the upgrade', () => {
      sharedBeforeEach('upgrade Authorizer', async () => {
        const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
        await actualAuthorizer.connect(govMultisig).grantRole(setAuthorizerAction, admin.address);

        await vault.connect(admin).setAuthorizer(authorizer.address);
        expect(await vault.getAuthorizer()).to.equal(authorizer.address);
      });

      it('the swap fee percentage can be still set', async () => {
        const tx = await pool.connect(swapFeeSetter).setSwapFeePercentage(fp(0.1));
        expectEvent.inReceipt(await tx.wait(), 'SwapFeePercentageChanged');
      });
    });
  });
});
