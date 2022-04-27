import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import TokensDeployer from '@balancer-labs/v2-helpers/src/models/tokens/TokensDeployer';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { ANY_ADDRESS, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { MONTH } from '@balancer-labs/v2-helpers/src/time';

describe('AumProtocolFeeCache', () => {
  const MAX_PROTOCOL_FEE = fp(0.5); // 50%
  const VAULT_PROTOCOL_FEE = fp(0.5); // 50%
  const NEW_VAULT_PROTOCOL_FEE = fp(0.3); // 30%
  const FIXED_PROTOCOL_FEE = fp(0.1); // 10%

  const AUM_PROTOCOL_FEE = fp(0.05); // 5%
  const NEW_AUM_PROTOCOL_FEE = fp(0.1); // 10%

  let protocolFeeCache: Contract;
  let aumProtocolFeesCollector: Contract;
  let admin: SignerWithAddress;
  let vault: Contract;
  let authorizer: Contract;
  let vaultObj: Vault;

  before('setup signers', async () => {
    [, admin] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault and protocol fees collector', async () => {
    const WETH = await TokensDeployer.deployToken({ symbol: 'WETH' });

    authorizer = await deploy('v2-vault/TimelockAuthorizer', { args: [admin.address, ZERO_ADDRESS, MONTH] });
    vault = await deploy('v2-vault/Vault', { args: [authorizer.address, WETH.address, MONTH, MONTH] });
    vaultObj = new Vault(false, vault, authorizer, admin);

    aumProtocolFeesCollector = await deploy('v2-standalone-utils/AumProtocolFeesCollector', { args: [vault.address] });

    const action = await actionId(aumProtocolFeesCollector, 'setAumFeePercentage');
    await authorizer.connect(admin).grantPermissions([action], admin.address, [ANY_ADDRESS]);
    await aumProtocolFeesCollector.connect(admin).setAumFeePercentage(AUM_PROTOCOL_FEE);
  });

  context('with delegated swap fee', () => {
    sharedBeforeEach('deploy delegated fee cache', async () => {
      await vaultObj.setSwapFeePercentage(VAULT_PROTOCOL_FEE, { from: admin });

      // The sentinel value used to designate delegated fees is MAX_UINT256
      protocolFeeCache = await deploy('MockAumProtocolFeeCache', {
        args: [vault.address, MAX_UINT256, aumProtocolFeesCollector.address],
      });
    });

    it('indicates delegated fees', async () => {
      expect(await protocolFeeCache.getProtocolFeeDelegation()).to.be.true;
    });

    it('gets the protocol fee from the vault', async () => {
      expect(await protocolFeeCache.getProtocolSwapFeePercentageCache()).to.equal(VAULT_PROTOCOL_FEE);
    });

    context('when the vault fee is updated', () => {
      sharedBeforeEach('update the main protocol fee', async () => {
        await vaultObj.setSwapFeePercentage(NEW_VAULT_PROTOCOL_FEE, { from: admin });
      });

      it('retrieves the old value when not updated', async () => {
        expect(await protocolFeeCache.getProtocolSwapFeePercentageCache()).to.equal(VAULT_PROTOCOL_FEE);
      });

      it('updates the cached value', async () => {
        await protocolFeeCache.updateProtocolSwapFeePercentageCache();

        expect(await protocolFeeCache.getProtocolSwapFeePercentageCache()).to.equal(NEW_VAULT_PROTOCOL_FEE);
      });

      it('emits an event when updating', async () => {
        const receipt = await protocolFeeCache.updateProtocolSwapFeePercentageCache();

        expectEvent.inReceipt(await receipt.wait(), 'ProtocolSwapFeePercentageCacheUpdated', {
          protocolSwapFeePercentage: NEW_VAULT_PROTOCOL_FEE,
        });
      });
    });
  });

  context('with fixed swap fee', () => {
    sharedBeforeEach('deploy fixed fee cache', async () => {
      protocolFeeCache = await deploy('MockAumProtocolFeeCache', {
        args: [vault.address, FIXED_PROTOCOL_FEE, aumProtocolFeesCollector.address],
      });
    });

    it('indicates fixed fees', async () => {
      expect(await protocolFeeCache.getProtocolFeeDelegation()).to.be.false;
    });

    it('sets the protocol fee', async () => {
      expect(await protocolFeeCache.getProtocolSwapFeePercentageCache()).to.equal(FIXED_PROTOCOL_FEE);
    });

    it('reverts if fee is too high', async () => {
      await expect(
        deploy('MockAumProtocolFeeCache', {
          args: [vault.address, MAX_PROTOCOL_FEE.add(1), aumProtocolFeesCollector.address],
        })
      ).to.be.revertedWith('SWAP_FEE_PERCENTAGE_TOO_HIGH');
    });

    it('reverts when trying to update fixed fee', async () => {
      await expect(protocolFeeCache.updateProtocolSwapFeePercentageCache()).to.be.revertedWith('INVALID_OPERATION');
    });
  });

  describe('AUM protocol fees', () => {
    sharedBeforeEach('deploy aum fee cache', async () => {
      protocolFeeCache = await deploy('MockAumProtocolFeeCache', {
        args: [vault.address, FIXED_PROTOCOL_FEE, aumProtocolFeesCollector.address],
      });
    });

    it('sets the AUM protocol fee', async () => {
      expect(await protocolFeeCache.getProtocolAumFeePercentageCache()).to.equal(AUM_PROTOCOL_FEE);
    });

    context('when the AUM protocol fee is updated', () => {
      sharedBeforeEach('update the AUM protocol fee', async () => {
        await aumProtocolFeesCollector.connect(admin).setAumFeePercentage(NEW_AUM_PROTOCOL_FEE);
      });

      it('retrieves the old value when not updated', async () => {
        expect(await protocolFeeCache.getProtocolAumFeePercentageCache()).to.equal(AUM_PROTOCOL_FEE);
      });

      it('updates the cached value', async () => {
        await protocolFeeCache.updateProtocolAumFeePercentageCache();

        expect(await protocolFeeCache.getProtocolSwapFeePercentageCache()).to.equal(NEW_AUM_PROTOCOL_FEE);
      });

      it('emits an event when updating', async () => {
        const receipt = await protocolFeeCache.updateProtocolAumFeePercentageCache();

        expectEvent.inReceipt(await receipt.wait(), 'ProtocolAumFeePercentageCacheUpdated', {
          protocolAumFeePercentage: NEW_AUM_PROTOCOL_FEE,
        });
      });
    });
  });
});
