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

describe('VotingEscrowRemapper', function () {
  let vault: Vault;
  let smartWalletChecker: Contract;
  let remapper: Contract;
  let votingEscrow: Contract, omniVotingEscrow: Contract;

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
    omniVotingEscrow = await deploy('MockOmniVotingEscrow');

    remapper = await deploy('VotingEscrowRemapper', { args: [votingEscrow.address, vault.address] });
  });

  sharedBeforeEach('grant permissions over smart wallet checker', async () => {
    await vault.grantPermissionGlobally(await actionId(smartWalletChecker, 'allowlistAddress'), admin);
    await vault.grantPermissionGlobally(await actionId(smartWalletChecker, 'denylistAddress'), admin);
  });

  describe('default getters', () => {
    it('gets voting escrow', async () => {
      expect(await remapper.getVotingEscrow()).to.be.eq(votingEscrow.address);
    });

    it('gets null omni voting escrow', async () => {
      expect(await remapper.getOmniVotingEscrow()).to.be.eq(ZERO_ADDRESS);
    });
  });

  describe('setOmniVotingEscrow', () => {
    context('without permissions', () => {
      it('reverts', async () => {
        await expect(remapper.setOmniVotingEscrow(omniVotingEscrow.address)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('with permissions', () => {
      sharedBeforeEach(async () => {
        await vault.grantPermissionGlobally(await actionId(remapper, 'setOmniVotingEscrow'), admin);
      });

      it('sets omni voting escrow', async () => {
        await remapper.connect(admin).setOmniVotingEscrow(omniVotingEscrow.address);
        expect(await remapper.getOmniVotingEscrow()).to.be.eq(omniVotingEscrow.address);
      });

      it('emits an event', async () => {
        const tx = await remapper.connect(admin).setOmniVotingEscrow(omniVotingEscrow.address);
        expectEvent.inReceipt(await tx.wait(), 'OmniVotingEscrowUpdated', {
          newOmniVotingEscrow: omniVotingEscrow.address,
        });
      });
    });
  });

  describe('setNetworkRemapping', () => {
    const chainId = 5;
    const otherChainId = 42;
    let caller: SignerWithAddress;

    sharedBeforeEach(async () => {
      await vault.grantPermissionGlobally(await actionId(remapper, 'setOmniVotingEscrow'), admin);
    });

    context('incorrect setup: deny-listed by smart wallet checker and OmniVotingEscrow unset', () => {
      it('reverts if the local user is not allowed by the smart wallet checker', async () => {
        await expect(remapper.connect(local).setNetworkRemapping(local.address, remote, chainId)).to.be.revertedWith(
          'Only contracts which can hold veBAL can set up a mapping'
        );
      });

      it('reverts if local user is allowed by the smart wallet checker, but OmniVotingEscrow is not set', async () => {
        await smartWalletChecker.connect(admin).allowlistAddress(local.address);
        await expect(remapper.connect(local).setNetworkRemapping(local.address, remote, chainId)).to.be.revertedWith(
          'Omni voting escrow not set'
        );
      });
    });

    context('correct setup: allow-listed by smart wallet checker and OmniVotingEscrow set', () => {
      sharedBeforeEach(async () => {
        await smartWalletChecker.connect(admin).allowlistAddress(local.address);
        await remapper.connect(admin).setOmniVotingEscrow(omniVotingEscrow.address);
      });

      context('when the caller is the local user', () => {
        sharedBeforeEach(() => {
          caller = local;
        });

        itRemapsCorrectly((remoteAddr) =>
          remapper.connect(caller).setNetworkRemapping(local.address, remoteAddr, chainId)
        );

        itRevertsIfRemoteUserIsZero();
      });

      context('when the caller is the remapping manager for the local user', () => {
        sharedBeforeEach(async () => {
          await vault.grantPermissionGlobally(await actionId(remapper, 'setNetworkRemappingManager'), admin);
          await remapper.connect(admin).setNetworkRemappingManager(local.address, manager.address);
          caller = manager;
        });

        itRemapsCorrectly((remoteAddr) =>
          remapper.connect(caller).setNetworkRemapping(local.address, remoteAddr, chainId)
        );

        it('reverts if remapping for another local user', async () => {
          await expect(remapper.connect(caller).setNetworkRemapping(other.address, remote, chainId)).to.be.revertedWith(
            'SENDER_NOT_ALLOWED'
          );
        });

        itRevertsIfRemoteUserIsZero();
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
          expect(await remapper.getRemoteUser(local.address, otherChainId)).to.be.eq(ZERO_ADDRESS);
        });

        it('maps the remote address to the local address', async () => {
          await doRemap(remote);
          expect(await remapper.getLocalUser(remote, chainId)).to.equal(local.address);
        });

        it('does not map the remote address on other chain ids', async () => {
          await doRemap(remote);
          expect(await remapper.getLocalUser(remote, otherChainId)).to.be.eq(ZERO_ADDRESS);
        });

        it('does not map the local address in the target chain ID to the local address', async () => {
          await doRemap(remote);
          expect(await remapper.getLocalUser(local.address, chainId)).to.be.eq(ZERO_ADDRESS);
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
          expect(await remapper.getLocalUser(remote, chainId)).to.be.eq(ZERO_ADDRESS);
        });

        it('reverts if the remote is already taken', async () => {
          await smartWalletChecker.connect(admin).allowlistAddress(other.address);
          await remapper.connect(other).setNetworkRemapping(other.address, remote, chainId);

          await expect(doRemap(remote)).to.be.revertedWith('Cannot overwrite an existing mapping by another user');
        });
      }

      function itRevertsIfRemoteUserIsZero() {
        it('reverts if remote address is zero', async () => {
          await expect(
            remapper.connect(caller).setNetworkRemapping(local.address, ZERO_ADDRESS, chainId)
          ).to.be.revertedWith('Zero address cannot be used as remote user');
        });
      }
    });
  });

  describe('clearNetworkRemapping', () => {
    const chainId = 7;
    const otherChainId = 43;
    let caller: SignerWithAddress;
    const doClearMap = async () => remapper.connect(caller).clearNetworkRemapping(local.address, chainId);

    function itClearsNetworkRemapping() {
      it('clears existing local to remote mapping in target chain ID', async () => {
        await doClearMap();
        expect(await remapper.getRemoteUser(local.address, chainId)).to.be.eq(ZERO_ADDRESS);
      });

      it('does not clear existing local to remote mapping in other chain ID', async () => {
        await doClearMap();
        expect(await remapper.getRemoteUser(local.address, otherChainId)).to.be.eq(remote);
      });

      it('clears existing remote to local mapping in target chain ID', async () => {
        await doClearMap();
        expect(await remapper.getLocalUser(remote, chainId)).to.be.eq(ZERO_ADDRESS);
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
    }

    sharedBeforeEach('setup mapping and denylist user', async () => {
      await smartWalletChecker.connect(admin).allowlistAddress(local.address);
      await vault.grantPermissionGlobally(await actionId(remapper, 'setOmniVotingEscrow'), admin);
      await remapper.connect(admin).setOmniVotingEscrow(omniVotingEscrow.address);

      await remapper.connect(local).setNetworkRemapping(local.address, remote, chainId);
      await remapper.connect(local).setNetworkRemapping(local.address, remote, otherChainId);

      await vault.grantPermissionGlobally(await actionId(remapper, 'setNetworkRemappingManager'), admin);
      await remapper.connect(admin).setNetworkRemappingManager(local.address, manager.address);

      // Verify mapping in chainId
      expect(await remapper.getRemoteUser(local.address, chainId)).to.be.eq(remote);
      expect(await remapper.getLocalUser(remote, chainId)).to.be.eq(local.address);
      // Verify mapping in otherChainId
      expect(await remapper.getRemoteUser(local.address, otherChainId)).to.be.eq(remote);
      expect(await remapper.getLocalUser(remote, otherChainId)).to.be.eq(local.address);
      // Verify remapping manager
      expect(await remapper.getRemappingManager(local.address)).to.be.eq(manager.address);
    });

    context('when local user is not allow-listed', async () => {
      sharedBeforeEach(async () => {
        await smartWalletChecker.connect(admin).denylistAddress(local.address);
        caller = other;
      });

      context('when omni voting escrow is not set', () => {
        sharedBeforeEach(async () => {
          await remapper.connect(admin).setOmniVotingEscrow(ZERO_ADDRESS);
        });

        it('reverts', async () => {
          await expect(doClearMap()).to.be.revertedWith('Omni voting escrow not set');
        });
      });

      context('when omni voting escrow is set', () => {
        itClearsNetworkRemapping();
      });
    });

    context('when local user is allow-listed', async () => {
      sharedBeforeEach(async () => {
        // Address is already allow-listed at this point; it cannot be re-allowed.
        expect(await smartWalletChecker.check(local.address)).to.be.true;
      });

      context('when caller is anyone but local user', () => {
        sharedBeforeEach(() => {
          caller = other;
        });

        it('reverts', async () => {
          await expect(doClearMap()).to.be.revertedWith('localUser is still in good standing');
        });
      });

      context('when caller it local user', () => {
        sharedBeforeEach(() => {
          caller = local;
        });

        itClearsNetworkRemapping();
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

    // Point to be assigned to `local` address in the voting escrow.
    const localPoint = {
      bias: 1,
      slope: 2,
      ts: 3,
      blk: 4,
    };

    // Point to be assigned to `other` address in the voting escrow.
    const otherPoint = {
      bias: 5,
      slope: 6,
      ts: 7,
      blk: 8,
    };

    // Point to be assigned to `remote` address in the voting escrow.
    const remotePoint = {
      bias: 9,
      slope: 10,
      ts: 11,
      blk: 12,
    };

    sharedBeforeEach(async () => {
      await smartWalletChecker.connect(admin).allowlistAddress(local.address);
      await vault.grantPermissionGlobally(await actionId(remapper, 'setOmniVotingEscrow'), admin);
      await remapper.connect(admin).setOmniVotingEscrow(omniVotingEscrow.address);

      await remapper.connect(local).setNetworkRemapping(local.address, remote, chainId);

      // Mock setters
      await votingEscrow.setUserPointEpoch(local.address, epoch);
      await votingEscrow.setUserPointHistory(local.address, epoch, localPoint);
      expect(await votingEscrow.user_point_epoch(local.address)).to.be.eq(epoch);
      expect(await votingEscrow.user_point_history(local.address, epoch)).to.be.deep.eq(Object.values(localPoint));

      await votingEscrow.setUserPointEpoch(other.address, epoch);
      await votingEscrow.setUserPointHistory(other.address, epoch, otherPoint);
      expect(await votingEscrow.user_point_epoch(other.address)).to.be.eq(epoch);
      expect(await votingEscrow.user_point_history(other.address, epoch)).to.be.deep.eq(Object.values(otherPoint));

      await votingEscrow.setUserPointEpoch(remote, epoch);
      await votingEscrow.setUserPointHistory(remote, epoch, remotePoint);
      expect(await votingEscrow.user_point_epoch(remote)).to.be.eq(epoch);
      expect(await votingEscrow.user_point_history(remote, epoch)).to.be.deep.eq(Object.values(remotePoint));
    });

    it('returns user point when a remapping exists', async () => {
      expect(await remapper.getUserPointOnRemoteChain(remote, chainId)).to.be.deep.eq(Object.values(localPoint));
    });

    it('returns user point when a remapping does not exist', async () => {
      expect(await remapper.getUserPointOnRemoteChain(other.address, chainId)).to.be.deep.eq(Object.values(otherPoint));
    });

    it('returns user point when user is not remapped in another chain ID', async () => {
      expect(await remapper.getUserPointOnRemoteChain(remote, otherChainId)).to.be.deep.eq(Object.values(remotePoint));
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

  describe('getLockedEnd', () => {
    const end = 12345;

    sharedBeforeEach(async () => {
      await votingEscrow.setLockedEnd(local.address, end);
      expect(await votingEscrow.locked__end(local.address)).to.be.eq(end);
    });

    it('returns locked end from voting escrow', async () => {
      expect(await remapper.getLockedEnd(local.address)).to.be.eq(end);
    });
  });
});
