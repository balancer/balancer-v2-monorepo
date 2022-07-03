import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import TokensDeployer from '@balancer-labs/v2-helpers/src/models/tokens/TokensDeployer';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { ANY_ADDRESS, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { MONTH } from '@balancer-labs/v2-helpers/src/time';

describe('AumProtocolFeeCache', () => {
  const AUM_PROTOCOL_FEE = fp(0.05); // 5%
  const NEW_AUM_PROTOCOL_FEE = fp(0.1); // 10%

  let feeCache: Contract;
  let aumProtocolFeesCollector: Contract;
  let admin: SignerWithAddress;
  let vault: Contract;
  let authorizer: Contract;

  before('setup signers', async () => {
    [, admin] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault and protocol fees collector', async () => {
    const WETH = await TokensDeployer.deployToken({ symbol: 'WETH' });

    authorizer = await deploy('v2-vault/TimelockAuthorizer', { args: [admin.address, ZERO_ADDRESS, MONTH] });
    vault = await deploy('v2-vault/Vault', { args: [authorizer.address, WETH.address, MONTH, MONTH] });

    aumProtocolFeesCollector = await deploy('v2-standalone-utils/AumProtocolFeesCollector', { args: [vault.address] });

    const action = await actionId(aumProtocolFeesCollector, 'setAumFeePercentage');
    await authorizer.connect(admin).grantPermissions([action], admin.address, [ANY_ADDRESS]);
    await aumProtocolFeesCollector.connect(admin).setAumFeePercentage(AUM_PROTOCOL_FEE);
  });

  describe('AUM protocol fees', () => {
    sharedBeforeEach('deploy aum fee cache', async () => {
      feeCache = await deploy('MockAumProtocolFeeCache', {
        args: [aumProtocolFeesCollector.address],
      });
    });

    it('sets the AUM protocol fee', async () => {
      expect(await feeCache.getProtocolAumFeePercentageCache()).to.equal(AUM_PROTOCOL_FEE);
    });

    context('when the AUM protocol fee is updated', () => {
      sharedBeforeEach('update the AUM protocol fee', async () => {
        await aumProtocolFeesCollector.connect(admin).setAumFeePercentage(NEW_AUM_PROTOCOL_FEE);
      });

      it('retrieves the old value when not updated', async () => {
        expect(await feeCache.getProtocolAumFeePercentageCache()).to.equal(AUM_PROTOCOL_FEE);
      });

      it('updates the cached value', async () => {
        await feeCache.updateProtocolAumFeePercentageCache();

        expect(await feeCache.getProtocolAumFeePercentageCache()).to.equal(NEW_AUM_PROTOCOL_FEE);
      });

      it('emits an event when updating', async () => {
        const receipt = await feeCache.updateProtocolAumFeePercentageCache();

        expectEvent.inReceipt(await receipt.wait(), 'ProtocolAumFeePercentageCacheUpdated', {
          protocolAumFeePercentage: NEW_AUM_PROTOCOL_FEE,
        });
      });
    });
  });
});
