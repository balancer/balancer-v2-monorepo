import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { solidityKeccak256 } from 'ethers/lib/utils';
import { WeiPerEther as ONE } from '@ethersproject/constants';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { expect } from 'chai';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { MAX_UINT256, ZERO_ADDRESS, ZERO_BYTES32 } from '@balancer-labs/v2-helpers/src/constants';
import { advanceToTimestamp, DAY, WEEK } from '@balancer-labs/v2-helpers/src/time';
import { parseFixed } from '@ethersproject/bignumber';

const DEFAULT_ADMIN_ROLE = ZERO_BYTES32;
const MINTER_ROLE = solidityKeccak256(['string'], ['MINTER_ROLE']);
const SNAPSHOT_ROLE = solidityKeccak256(['string'], ['SNAPSHOT_ROLE']);

const INITIAL_RATE = parseFixed('145000', 18).div(WEEK);
const RATE_REDUCTION_COEFFICIENT = BigNumber.from('1189207115002721024');

describe('BalancerTokenAdmin', () => {
  let vault: Vault;
  let authorizer: Contract;
  let token: Contract;
  let tokenAdmin: Contract;
  let admin: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy authorizer', async () => {
    vault = await Vault.create({ admin });
    if (!vault.authorizer) throw Error('Vault has no Authorizer');
    authorizer = vault.authorizer;
    token = await deploy('TestBalancerToken', { args: [admin.address, 'Balancer', 'BAL'] });
    tokenAdmin = await deploy('BalancerTokenAdmin', { args: [vault.address, token.address] });
  });

  describe('constructor', () => {
    it('sets the vault address', async () => {
      expect(await tokenAdmin.getVault()).to.be.eq(vault.address);
    });

    it('uses the authorizer of the vault', async () => {
      expect(await tokenAdmin.getAuthorizer()).to.equal(authorizer.address);
    });

    it('tracks authorizer changes in the vault', async () => {
      const action = await actionId(vault.instance, 'setAuthorizer');
      await vault.grantPermissionsGlobally([action], admin.address);

      await vault.instance.connect(admin).setAuthorizer(other.address);

      expect(await tokenAdmin.getAuthorizer()).to.equal(other.address);
    });

    it('sets the startEpochTime to the sentinel value', async () => {
      expect(await tokenAdmin.getStartEpochTime()).to.be.eq(MAX_UINT256);
    });
  });

  describe('activate', () => {
    context('when the caller is not authorised to call this function', () => {
      it('reverts', async () => {
        await expect(tokenAdmin.connect(other).activate()).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when the caller is authorised to call this function', () => {
      sharedBeforeEach('authorize caller', async () => {
        const action = await actionId(tokenAdmin, 'activate');
        await vault.grantPermissionsGlobally([action], admin.address);
      });

      context('when BalancerTokenAdmin has been activated already', () => {
        sharedBeforeEach('activate', async () => {
          await token.connect(admin).grantRole(DEFAULT_ADMIN_ROLE, tokenAdmin.address);
          await tokenAdmin.connect(admin).activate();
        });

        it('reverts', async () => {
          await expect(tokenAdmin.connect(admin).activate()).to.be.revertedWith('Already activated');
        });
      });

      context('when BalancerTokenAdmin has not been activated yet', () => {
        context("when the BalancerTokenAdmin doesn't have admin powers over the BAL token", () => {
          it('reverts', async () => {
            await expect(tokenAdmin.connect(admin).activate()).to.be.revertedWith('BalancerTokenAdmin is not an admin');
          });
        });

        context('when the BalancerTokenAdmin has admin powers over the BAL token', () => {
          sharedBeforeEach('activate', async () => {
            await token.connect(admin).grantRole(DEFAULT_ADMIN_ROLE, tokenAdmin.address);
          });

          it('it revokes MINTER_ROLE from all addresses other than itself', async () => {
            await token.connect(admin).grantRole(MINTER_ROLE, other.address);
            expect(await token.getRoleMemberCount(MINTER_ROLE)).to.be.gt(0);

            await tokenAdmin.connect(admin).activate();

            expect(await token.getRoleMemberCount(MINTER_ROLE)).to.be.eq(1);
            expect(await token.hasRole(MINTER_ROLE, tokenAdmin.address)).to.be.true;
            expect(await token.hasRole(MINTER_ROLE, other.address)).to.be.false;
          });

          it('it revokes SNAPSHOT_ROLE from all addresses other than itself', async () => {
            await token.connect(admin).grantRole(SNAPSHOT_ROLE, other.address);
            expect(await token.getRoleMemberCount(SNAPSHOT_ROLE)).to.be.gt(0);

            await tokenAdmin.connect(admin).activate();

            expect(await token.getRoleMemberCount(SNAPSHOT_ROLE)).to.be.eq(1);
            expect(await token.hasRole(SNAPSHOT_ROLE, tokenAdmin.address)).to.be.true;
            expect(await token.hasRole(SNAPSHOT_ROLE, other.address)).to.be.false;
          });

          it('it revokes GLOBAL_ADMIN_ROLE from all addresses', async () => {
            expect(await token.getRoleMemberCount(DEFAULT_ADMIN_ROLE)).to.be.gt(0);

            await tokenAdmin.connect(admin).activate();

            expect(await token.getRoleMemberCount(DEFAULT_ADMIN_ROLE)).to.be.eq(0);
          });

          it('it sets the initial inflation parameters', async () => {
            const tx = await tokenAdmin.connect(admin).activate();
            const receipt = await tx.wait();
            const { timestamp } = await ethers.provider.getBlock(receipt.blockHash);

            expect(await tokenAdmin.getStartEpochTime()).to.be.eq(timestamp);
            expect(await tokenAdmin.getStartEpochSupply()).to.be.eq(await token.totalSupply());
            expect(await tokenAdmin.getInflationRate()).to.be.eq(INITIAL_RATE);
          });

          it('it emits an MiningParametersUpdated event', async () => {
            const tx = await tokenAdmin.connect(admin).activate();
            const receipt = await tx.wait();

            expectEvent.inReceipt(receipt, 'MiningParametersUpdated', {
              rate: INITIAL_RATE,
              supply: await token.totalSupply(),
            });
          });
        });
      });
    });
  });

  describe('updateMiningParameters', () => {
    context('when BalancerTokenAdmin has been activated', () => {
      sharedBeforeEach('activate', async () => {
        const action = await actionId(tokenAdmin, 'activate');
        await vault.grantPermissionsGlobally([action], admin.address);

        await token.connect(admin).grantRole(DEFAULT_ADMIN_ROLE, tokenAdmin.address);
        await tokenAdmin.connect(admin).activate();
      });

      context('when current epoch has not finished', () => {
        it('reverts', async () => {
          await expect(tokenAdmin.updateMiningParameters()).to.be.revertedWith('Epoch has not finished yet');
        });
      });

      context('when current epoch has finished', () => {
        let expectedRate: BigNumber;
        let expectedStartSupply: BigNumber;

        sharedBeforeEach('activate', async () => {
          const startOfNextEpoch = await tokenAdmin.callStatic.futureEpochTimeWrite();
          await advanceToTimestamp(startOfNextEpoch.add(1));

          const currentRate = await tokenAdmin.rate();
          expectedRate = currentRate.mul(ONE).div(RATE_REDUCTION_COEFFICIENT);
          expectedStartSupply = (await tokenAdmin.getStartEpochSupply()) + currentRate.mul(365 * DAY);
        });

        it('update the mining parameters', async () => {
          const tx = await tokenAdmin.updateMiningParameters();
          const receipt = await tx.wait();

          expectEvent.inReceipt(receipt, 'MiningParametersUpdated', {
            rate: expectedRate,
            supply: expectedStartSupply,
          });
        });
      });
    });

    context('when BalancerTokenAdmin has not been activated', () => {
      it('reverts', async () => {
        await expect(tokenAdmin.updateMiningParameters()).to.be.revertedWith('ADD_OVERFLOW');
      });
    });
  });

  describe('mint', () => {
    sharedBeforeEach('activate BalancerTokenAdmin', async () => {
      const action = await actionId(tokenAdmin, 'activate');
      await vault.grantPermissionsGlobally([action], admin.address);

      await token.connect(admin).grantRole(DEFAULT_ADMIN_ROLE, tokenAdmin.address);
      await tokenAdmin.connect(admin).activate();
    });

    context('when the caller is not authorised to call this function', () => {
      it('reverts', async () => {
        await expect(tokenAdmin.connect(other).mint(other.address, 1)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when the caller is authorised to call this function', () => {
      sharedBeforeEach('activate', async () => {
        const action = await actionId(tokenAdmin, 'mint');
        await vault.grantPermissionsGlobally([action], admin.address);
      });

      context('when mint does not exceed available supply', () => {
        it('mints the tokens', async () => {
          const value = 1;
          const tx = await tokenAdmin.connect(admin).mint(other.address, value);
          const receipt = await tx.wait();

          expectEvent.inIndirectReceipt(receipt, token.interface, 'Transfer', {
            from: ZERO_ADDRESS,
            to: other.address,
            value,
          });
        });
      });

      context('when trying to mint more than the available supply', () => {
        it('reverts', async () => {
          const availableSupply = await tokenAdmin.getAvailableSupply();
          const totalSupply = await token.totalSupply();
          const rate = await tokenAdmin.rate();

          const invalidMintAmount = availableSupply.sub(totalSupply).add(rate.mul(10));
          await expect(tokenAdmin.connect(admin).mint(other.address, invalidMintAmount)).to.be.revertedWith(
            'Mint amount exceeds remaining available supply'
          );
        });
      });
    });
  });

  describe('snapshot', () => {
    context('when the caller is not authorised to call this function', () => {
      it('reverts', async () => {
        await expect(tokenAdmin.connect(other).snapshot()).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when the caller is authorised to call this function', () => {
      sharedBeforeEach('activate', async () => {
        await token.connect(admin).grantRole(SNAPSHOT_ROLE, tokenAdmin.address);

        const action = await actionId(tokenAdmin, 'snapshot');
        await vault.grantPermissionsGlobally([action], admin.address);
      });

      it('emits a Snapshot event', async () => {
        const tx = await tokenAdmin.connect(admin).snapshot();

        expectEvent.inIndirectReceipt(await tx.wait(), token.interface, 'Snapshot', {
          id: 0,
        });
      });
    });
  });
});
