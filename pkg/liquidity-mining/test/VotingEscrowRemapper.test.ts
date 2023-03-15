import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract, ContractTransaction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { ZERO_ADDRESS, randomAddress } from '@balancer-labs/v2-helpers/src/constants';
import { bn } from '@balancer-labs/v2-helpers/src/numbers';

describe.only('VotingEscrowRemapper', function () {
  let vault: Vault;
  let smartWalletChecker: Contract;
  let remapper: Contract;
  let votingEscrow: Contract;

  let admin: SignerWithAddress, local: SignerWithAddress, manager: SignerWithAddress, other: SignerWithAddress;
  let remote: string;

  before(async () => {
    [, admin, local, manager, other] = await ethers.getSigners();
    remote = randomAddress();
  });

  sharedBeforeEach(async () => {
    vault = await Vault.create({ admin });

    smartWalletChecker = await deploy('SmartWalletChecker', { args: [vault.address, []] });
    votingEscrow = await deploy('MockVotingEscrow', { args: [smartWalletChecker.address] });

    remapper = await deploy('VotingEscrowRemapper', { args: [votingEscrow.address, vault.address] });
  });

  sharedBeforeEach('grant permissions to allow/denylist tokens', async () => {
    await vault.grantPermissionGlobally(await actionId(smartWalletChecker, 'allowlistAddress'), admin);
    await vault.grantPermissionGlobally(await actionId(smartWalletChecker, 'denylistAddress'), admin);
  });

  describe('setNetworkRemapping', () => {
    const chainId = 5;
    const otherChainId = 42;

    it('reverts if the local user is not allowed by the smart wallet checker', async () => {
      await expect(remapper.connect(local).setNetworkRemapping(local.address, remote, chainId)).to.be.revertedWith(
        'Only contracts which can hold veBAL can set up a mapping'
      );
    });

    context('when the local user is allowed by the smart wallet checker', () => {
      sharedBeforeEach(async () => {
        await smartWalletChecker.connect(admin).allowlistAddress(local.address);
      });

      context('when the caller is the local user', () => {
        itRemapsCorrectly((remoteAddr) =>
          remapper.connect(local).setNetworkRemapping(local.address, remoteAddr, chainId)
        );
      });

      context('when the caller is the remapping manager for the local user', () => {
        sharedBeforeEach(async () => {
          await vault.grantPermissionGlobally(await actionId(remapper, 'setNetworkRemappingManager'), admin);
          await remapper.connect(admin).setNetworkRemappingManager(local.address, manager.address);
        });

        itRemapsCorrectly((remoteAddr) =>
          remapper.connect(manager).setNetworkRemapping(local.address, remoteAddr, chainId)
        );

        it('reverts if remapping for another local user', async () => {
          await expect(
            remapper.connect(manager).setNetworkRemapping(other.address, remote, chainId)
          ).to.be.revertedWith('SENDER_NOT_ALLOWED');
        });
      });

      context('when the caller is another user', async () => {
        it('reverts', async () => {
          await expect(remapper.connect(other).setNetworkRemapping(local.address, remote, chainId)).to.be.revertedWith(
            'SENDER_NOT_ALLOWED'
          );
        });
      });

      function itRemapsCorrectly(doRemap: (remoteAddr: string) => Promise<ContractTransaction>) {
        it('maps the local address to the remote address', async () => {
          await doRemap(remote);
          expect(await remapper.getRemoteUser(local.address, chainId)).to.equal(remote);
        });

        it('does not map the local address on other chain ids', async () => {
          await doRemap(remote);
          expect(await remapper.getRemoteUser(local.address, otherChainId)).to.equal(local.address);
        });

        it('maps the remote address to the local address', async () => {
          await doRemap(remote);
          expect(await remapper.getLocalUser(remote, chainId)).to.equal(local.address);
        });

        it('does not map the remote address on other chain ids', async () => {
          await doRemap(remote);
          expect(await remapper.getLocalUser(remote, otherChainId)).to.equal(remote);
        });

        it('defaults the local address in the chain ID to the local address', async () => {
          await doRemap(remote);
          expect(await remapper.getLocalUser(local.address, chainId)).to.equal(local.address);
        });

        it('emits an AddressMappingUpdated event', async () => {
          const receipt = await doRemap(remote);

          expectEvent.inReceipt(await receipt.wait(), 'AddressMappingUpdated', {
            localUser: local.address,
            remoteUser: remote,
            chainId,
          });
        });

        it('clears previous entries', async () => {
          await doRemap(remote);
          // local <==> remote
          expect(await remapper.getLocalUser(remote, chainId)).to.equal(local.address);

          await doRemap(other.address);
          // local <==> other; remote <==> remote (cleared)
          expect(await remapper.getLocalUser(remote, chainId)).to.equal(remote);
        });

        it('reverts if the remote is already taken', async () => {
          await smartWalletChecker.connect(admin).allowlistAddress(other.address);
          await remapper.connect(other).setNetworkRemapping(other.address, remote, chainId);

          await expect(doRemap(remote)).to.be.revertedWith('Cannot overwrite an existing mapping by another user');
        });
      }
    });
  });

  describe('clearNetworkRemapping', () => {
    const chainId = 7;
    const otherChainId = 43;
    const doClearMap = async () => remapper.clearNetworkRemapping(local.address, chainId);

    context('when local user is not allow-listed', async () => {
      sharedBeforeEach('setup mapping and denylist user', async () => {
        await smartWalletChecker.connect(admin).allowlistAddress(local.address);
        await remapper.connect(local).setNetworkRemapping(local.address, remote, chainId);
        await remapper.connect(local).setNetworkRemapping(local.address, remote, otherChainId);

        await vault.grantPermissionGlobally(await actionId(remapper, 'setNetworkRemappingManager'), admin);
        await remapper.connect(admin).setNetworkRemappingManager(local.address, manager.address);

        await smartWalletChecker.connect(admin).denylistAddress(local.address);

        // Verify mapping in chainId
        expect(await remapper.getRemoteUser(local.address, chainId)).to.be.eq(remote);
        expect(await remapper.getLocalUser(remote, chainId)).to.be.eq(local.address);
        // Verify mapping in otherChainId
        expect(await remapper.getRemoteUser(local.address, otherChainId)).to.be.eq(remote);
        expect(await remapper.getLocalUser(remote, otherChainId)).to.be.eq(local.address);
        // Verify remapping manager
        expect(await remapper.getRemappingManager(local.address)).to.be.eq(manager.address);
      });

      it('clears existing local to remote mapping in target chain ID', async () => {
        await doClearMap();
        expect(await remapper.getRemoteUser(local.address, chainId)).to.be.eq(local.address);
      });

      it('does not clear existing local to remote mapping in other chain ID', async () => {
        await doClearMap();
        expect(await remapper.getRemoteUser(local.address, otherChainId)).to.be.eq(remote);
      });

      it('clears existing remote to local mapping in target chain ID', async () => {
        await doClearMap();
        expect(await remapper.getLocalUser(remote, chainId)).to.be.eq(remote);
      });

      it('does not clear existing remote to local mapping in other chain ID', async () => {
        await doClearMap();
        expect(await remapper.getLocalUser(remote, otherChainId)).to.be.eq(local.address);
      });

      it('clears existing remapping manager', async () => {
        await doClearMap();
        expect(await remapper.getRemappingManager(local.address)).to.be.eq(ZERO_ADDRESS);
      });

      it('emits an AddressMappingUpdated event', async () => {
        const tx = await doClearMap();

        expectEvent.inReceipt(await tx.wait(), 'AddressMappingUpdated', {
          localUser: local.address,
          remoteUser: ZERO_ADDRESS,
          chainId,
        });
      });

      it('emits an AddressDelegateUpdated event', async () => {
        const tx = await doClearMap();

        expectEvent.inReceipt(await tx.wait(), 'AddressDelegateUpdated', {
          localUser: local.address,
          delegate: ZERO_ADDRESS,
        });
      });
    });

    context('when local user is allow-listed', async () => {
      sharedBeforeEach(async () => {
        await smartWalletChecker.connect(admin).allowlistAddress(local.address);
      });

      it('reverts', async () => {
        await expect(doClearMap()).to.be.revertedWith('localUser is still in good standing.');
      });
    });
  });

  describe('setNetworkRemappingManager', () => {
    context('when the caller is authorized', async () => {
      sharedBeforeEach(async () => {
        await vault.grantPermissionGlobally(await actionId(remapper, 'setNetworkRemappingManager'), admin);
        await smartWalletChecker.connect(admin).allowlistAddress(local.address);
      });

      it('sets the remapping manager', async () => {
        await remapper.connect(admin).setNetworkRemappingManager(local.address, manager.address);
        expect(await remapper.getRemappingManager(local.address)).to.equal(manager.address);
      });

      it('emits an AddressDelegateUpdated event', async () => {
        const receipt = await remapper.connect(admin).setNetworkRemappingManager(local.address, manager.address);

        expectEvent.inReceipt(await receipt.wait(), 'AddressDelegateUpdated', {
          localUser: local.address,
          delegate: manager.address,
        });
      });

      it('reverts if the local user is not allowed by the smart wallet checker', async () => {
        await expect(
          remapper.connect(admin).setNetworkRemappingManager(other.address, manager.address)
        ).to.be.revertedWith('Only contracts which can hold veBAL may have a delegate');
      });
    });

    context('when the caller is not authorized', async () => {
      it('reverts', async () => {
        await expect(
          remapper.connect(other).setNetworkRemappingManager(local.address, manager.address)
        ).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });
  });

  describe('getUserPointOnRemoteChain', () => {
    const chainId = 37;
    const otherChainId = 15;
    const epoch = 23;
    const point = {
      bias: 3,
      slope: -7,
      ts: 134,
      blk: 157,
    };

    sharedBeforeEach(async () => {
      await smartWalletChecker.connect(admin).allowlistAddress(local.address);
      await remapper.connect(local).setNetworkRemapping(local.address, remote, chainId);

      // Mock setters
      await votingEscrow.setUserPointEpoch(local.address, epoch);
      await votingEscrow.setUserPointHistory(local.address, epoch, point);
      expect(await votingEscrow.user_point_epoch(local.address)).to.be.eq(epoch);
      expect(await votingEscrow.user_point_history(local.address, epoch)).to.be.deep.eq(Object.values(point));
    });

    it('returns user point on remote chain', async () => {
      expect(await remapper.getUserPointOnRemoteChain(remote, chainId)).to.be.deep.eq(Object.values(point));
    });

    it('returns user point on local chain', async () => {
      // `local` maps to `remote` in chain ID, but `getLocalUser(local, chainId)` also maps to `local`.
      expect(await remapper.getUserPointOnRemoteChain(local.address, chainId)).to.be.deep.eq(Object.values(point));
    });

    it('returns a null point for other chain ID', async () => {
      expect(await remapper.getUserPointOnRemoteChain(remote, otherChainId)).to.be.deep.eq(
        Array(Object.keys(point).length).fill(bn(0))
      );
    });
  });

  describe('getTotalSupplyPoint', () => {
    const epoch = 123;
    const point = {
      bias: 30,
      slope: -70,
      ts: 178,
      blk: 1567,
    };

    sharedBeforeEach(async () => {
      // Mock setters
      await votingEscrow.setEpoch(epoch);
      await votingEscrow.setPointHistory(epoch, point);
      expect(await votingEscrow.epoch()).to.be.eq(epoch);
      expect(await votingEscrow.point_history(epoch)).to.be.deep.eq(Object.values(point));
    });

    it('returns total supply for epoch', async () => {
      expect(await remapper.getTotalSupplyPoint()).to.be.deep.eq(Object.values(point));
    });
  });
});