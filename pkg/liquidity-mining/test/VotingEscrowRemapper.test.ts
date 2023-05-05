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
import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';

describe('VotingEscrowRemapper', function () {
  let vault: Vault;
  let smartWalletChecker: Contract;
  let remapper: Contract;
  let votingEscrow: Contract, omniVotingEscrow: Contract, omniVotingEscrowAdaptor: Contract;

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
    omniVotingEscrowAdaptor = await deploy('OmniVotingEscrowAdaptor', { args: [vault.address] });

    remapper = await deploy('VotingEscrowRemapper', {
      args: [vault.address, votingEscrow.address, omniVotingEscrowAdaptor.address],
    });
  });

  sharedBeforeEach('grant permissions over smart wallet checker', async () => {
    await vault.grantPermissionGlobally(await actionId(smartWalletChecker, 'allowlistAddress'), admin);
    await vault.grantPermissionGlobally(await actionId(smartWalletChecker, 'denylistAddress'), admin);
  });

  describe('default getters', () => {
    it('gets voting escrow', async () => {
      expect(await remapper.getVotingEscrow()).to.be.eq(votingEscrow.address);
    });

    it('gets omni voting escrow adaptor', async () => {
      expect(await remapper.getOmniVotingEscrowAdaptor()).to.be.eq(omniVotingEscrowAdaptor.address);
    });
  });

  describe('setNetworkRemapping', () => {
    const chainId = 5;
    const otherChainId = 42;
    let caller: SignerWithAddress;

    sharedBeforeEach(async () => {
      await vault.grantPermissionGlobally(await actionId(omniVotingEscrowAdaptor, 'setOmniVotingEscrow'), admin);
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

    context('correct setup: allow-listed by smart wallet checker and OmniVotingEscrow set in the adaptor', () => {
      sharedBeforeEach(async () => {
        await smartWalletChecker.connect(admin).allowlistAddress(local.address);
        await omniVotingEscrowAdaptor.connect(admin).setOmniVotingEscrow(omniVotingEscrow.address);
      });

      context('when the caller is the local user', () => {
        sharedBeforeEach(() => {
          caller = local;
        });

        itRemapsCorrectly((remoteAddr) =>
          remapper.connect(caller).setNetworkRemapping(local.address, remoteAddr, chainId)
        );

        itInteractsWithBridge((value) =>
          remapper.connect(caller).setNetworkRemapping(local.address, remote, chainId, { value })
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

        itInteractsWithBridge((value) =>
          remapper.connect(caller).setNetworkRemapping(local.address, remote, chainId, { value })
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
          const tx = await doRemap(remote);

          expectEvent.inReceipt(await tx.wait(), 'AddressMappingUpdated', {
            localUser: local.address,
            remoteUser: remote,
            chainId,
          });
        });

        it('does not emit RemoteAddressMappingCleared event when this is a new mapping', async () => {
          const tx = await doRemap(remote);
          expectEvent.notEmitted(await tx.wait(), 'RemoteAddressMappingCleared');
        });

        it('emits RemoteAddressMappingCleared event when this is a remapping', async () => {
          await doRemap(other.address);
          const tx = await doRemap(remote);

          expectEvent.inReceipt(await tx.wait(), 'RemoteAddressMappingCleared', {
            remoteUser: other.address,
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

        it('reverts if the remote is already taken (A --> B, then C cannot map to B)', async () => {
          await smartWalletChecker.connect(admin).allowlistAddress(other.address);
          await remapper.connect(other).setNetworkRemapping(other.address, remote, chainId);

          await expect(doRemap(remote)).to.be.revertedWith('Cannot overwrite an existing mapping by another user');
        });

        it('reverts if local address is mapped somewhere else (A --> B, then C cannot map to A)', async () => {
          await smartWalletChecker.connect(admin).allowlistAddress(other.address);
          await remapper.connect(other).setNetworkRemapping(other.address, remote, chainId);

          await expect(doRemap(other.address)).to.be.revertedWith('Cannot remap to an address that is in use locally');
        });

        it('reverts if local address is the remote address for somebody else (A --> B, then B cannot map to C)', async () => {
          await smartWalletChecker.connect(admin).allowlistAddress(other.address);
          await remapper.connect(other).setNetworkRemapping(other.address, local.address, chainId);

          await expect(doRemap(remote)).to.be.revertedWith('Cannot remap to an address that is in use remotely');
        });

        it('reverts if target remote address has veBAL (griefing)', async () => {
          await votingEscrow.setBalanceOf(remote, 1);
          await expect(doRemap(remote)).to.be.revertedWith('Target remote address has non-zero veBAL balance');
        });
      }

      function itInteractsWithBridge(doRemap: (value: BigNumberish) => Promise<ContractTransaction>) {
        describe('bridge interaction', () => {
          const nativeFee = 20;

          sharedBeforeEach(async () => {
            await omniVotingEscrow.setNativeFee(nativeFee, chainId);
          });

          context('when the value sent does not cover the minimum fee amount', () => {
            it('reverts with single bridge / no pre-existing remapping', async () => {
              await expect(doRemap(nativeFee - 1)).to.be.revertedWith('Insufficient ETH to bridge user balance');
            });

            it('reverts with double bridge / pre-existing remapping', async () => {
              await remapper
                .connect(local)
                .setNetworkRemapping(local.address, other.address, chainId, { value: nativeFee });

              await expect(doRemap(nativeFee * 2 - 1)).to.be.revertedWith('Insufficient ETH to bridge user balance');
            });
          });

          context('when the value sent covers the minimum fee amount', () => {
            it('bridges only the remapped address if there was no pre-existing one', async () => {
              const tx = await doRemap(nativeFee);
              expectEvent.inIndirectReceipt(
                await tx.wait(),
                omniVotingEscrow.interface,
                'SendUserBalance',
                {
                  user: local.address,
                  chainId,
                  refundAddress: caller.address,
                },
                omniVotingEscrow.address,
                1
              );
            });

            it('returns the unspent ETH', async () => {
              const balanceBefore = await ethers.provider.getBalance(caller.address);
              const receipt = await (await doRemap(nativeFee * 1000)).wait();
              const ethSpentOnGas = receipt.gasUsed.mul(receipt.effectiveGasPrice);
              expect(await ethers.provider.getBalance(caller.address)).to.be.eq(
                balanceBefore.sub(ethSpentOnGas).sub(nativeFee)
              );
            });

            it('bridges the remapped address and clears the pre-existing one', async () => {
              await remapper
                .connect(local)
                .setNetworkRemapping(local.address, other.address, chainId, { value: nativeFee });

              const receipt = await (await doRemap(nativeFee * 2)).wait();
              expectEvent.inIndirectReceipt(
                receipt,
                omniVotingEscrow.interface,
                'SendUserBalance',
                {
                  user: local.address,
                  chainId,
                  refundAddress: caller.address,
                },
                omniVotingEscrow.address
              );

              expectEvent.inIndirectReceipt(
                receipt,
                omniVotingEscrow.interface,
                'SendUserBalance',
                {
                  user: other.address,
                  chainId,
                  refundAddress: caller.address,
                },
                omniVotingEscrow.address
              );
            });
          });
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
    const doClearMap = async (value = 0) =>
      remapper.connect(caller).clearNetworkRemapping(local.address, chainId, { value });

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

      it('emits an AddressMappingUpdated event', async () => {
        const tx = await doClearMap();

        expectEvent.inReceipt(await tx.wait(), 'AddressMappingUpdated', {
          localUser: local.address,
          remoteUser: ZERO_ADDRESS,
          chainId,
        });
      });

      it('emits an RemoteAddressMappingCleared event', async () => {
        const tx = await doClearMap();

        expectEvent.inReceipt(await tx.wait(), 'RemoteAddressMappingCleared', {
          remoteUser: remote,
          chainId,
        });
      });

      it('bridges the local and the remote addresses', async () => {
        const receipt = await (await doClearMap()).wait();
        expectEvent.inIndirectReceipt(
          receipt,
          omniVotingEscrow.interface,
          'SendUserBalance',
          {
            user: local.address,
            chainId,
            refundAddress: caller.address,
          },
          omniVotingEscrow.address
        );

        expectEvent.inIndirectReceipt(
          receipt,
          omniVotingEscrow.interface,
          'SendUserBalance',
          {
            user: remote,
            chainId,
            refundAddress: caller.address,
          },
          omniVotingEscrow.address
        );
      });

      it('returns the unspent ETH', async () => {
        const nativeFee = 30;
        await omniVotingEscrow.setNativeFee(nativeFee, chainId);

        const balanceBefore = await ethers.provider.getBalance(caller.address);
        const receipt = await (await doClearMap(nativeFee * 1000)).wait();
        const ethSpentOnGas = receipt.gasUsed.mul(receipt.effectiveGasPrice);

        // There are two brige calls, so the value spent is native fee * 2.
        expect(await ethers.provider.getBalance(caller.address)).to.be.eq(
          balanceBefore.sub(ethSpentOnGas).sub(nativeFee * 2)
        );
      });
    }

    sharedBeforeEach('setup mapping and denylist user', async () => {
      await smartWalletChecker.connect(admin).allowlistAddress(local.address);
      await vault.grantPermissionGlobally(await actionId(omniVotingEscrowAdaptor, 'setOmniVotingEscrow'), admin);
      await omniVotingEscrowAdaptor.connect(admin).setOmniVotingEscrow(omniVotingEscrow.address);

      await remapper.connect(local).setNetworkRemapping(local.address, remote, chainId);
      await remapper.connect(local).setNetworkRemapping(local.address, remote, otherChainId);

      // Verify mapping in chainId
      expect(await remapper.getRemoteUser(local.address, chainId)).to.be.eq(remote);
      expect(await remapper.getLocalUser(remote, chainId)).to.be.eq(local.address);
      // Verify mapping in otherChainId
      expect(await remapper.getRemoteUser(local.address, otherChainId)).to.be.eq(remote);
      expect(await remapper.getLocalUser(remote, otherChainId)).to.be.eq(local.address);
    });

    context('when local user is not allow-listed', async () => {
      sharedBeforeEach(async () => {
        await smartWalletChecker.connect(admin).denylistAddress(local.address);
        caller = other;
      });

      context('when omni voting escrow is not set', () => {
        sharedBeforeEach(async () => {
          await omniVotingEscrowAdaptor.connect(admin).setOmniVotingEscrow(ZERO_ADDRESS);
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

      context('when caller is local user', () => {
        sharedBeforeEach(() => {
          caller = local;
        });

        itClearsNetworkRemapping();
      });
    });

    context('when local user is zero address', () => {
      it('reverts', async () => {
        await expect(remapper.clearNetworkRemapping(ZERO_ADDRESS, chainId)).to.be.revertedWith(
          'localUser cannot be zero address'
        );
      });
    });

    context('when local user is not remapped', () => {
      it('reverts', async () => {
        await expect(remapper.connect(other).clearNetworkRemapping(other.address, chainId)).to.be.revertedWith(
          'Remapping to clear does not exist'
        );
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

  describe('getUserPoint', () => {
    const epoch = 123;
    const point = {
      bias: 30,
      slope: -70,
      ts: 178,
      blk: 1567,
    };

    sharedBeforeEach(async () => {
      // Mock setters
      await votingEscrow.setUserPointEpoch(local.address, epoch);
      await votingEscrow.setUserPointHistory(local.address, epoch, point);
      expect(await votingEscrow.user_point_epoch(local.address)).to.be.eq(epoch);
      expect(await votingEscrow.user_point_history(local.address, epoch)).to.be.deep.eq(Object.values(point));
      expect(await votingEscrow.user_point_history(remote, epoch)).to.be.deep.eq(
        Array(Object.keys(point).length).fill(0)
      );
    });

    it('returns balance for epoch', async () => {
      expect(await remapper.getUserPoint(local.address)).to.be.deep.eq(Object.values(point));
    });

    it('is unaffected by remappings', async () => {
      await smartWalletChecker.connect(admin).allowlistAddress(local.address);
      await vault.grantPermissionGlobally(await actionId(omniVotingEscrowAdaptor, 'setOmniVotingEscrow'), admin);
      await omniVotingEscrowAdaptor.connect(admin).setOmniVotingEscrow(omniVotingEscrow.address);

      await remapper.connect(local).setNetworkRemapping(local.address, remote, 1);
      expect(await remapper.getRemoteUser(local.address, 1)).to.equal(remote);

      expect(await remapper.getUserPoint(local.address)).to.be.deep.eq(Object.values(point));
      expect(await remapper.getUserPoint(remote)).to.be.deep.eq(Array(Object.keys(point).length).fill(0));
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
