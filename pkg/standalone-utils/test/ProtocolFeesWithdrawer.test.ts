import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

describe('ProtocolFeesWithdrawer', function () {
  let vault: Vault;
  let protocolFeesCollector: Contract;
  let protocolFeesWithdrawer: Contract;

  let admin: SignerWithAddress, claimer: SignerWithAddress, other: SignerWithAddress;
  let allTokens: TokenList;
  let allowlistedTokens: TokenList, denylistedTokens: TokenList;

  before(async () => {
    [, admin, claimer, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault & tokens', async () => {
    vault = await Vault.create({ admin });
    protocolFeesCollector = await vault.getFeesCollector();

    allTokens = await TokenList.create(['DAI', 'MKR', 'SNX', 'BAT'], { sorted: true });
    denylistedTokens = allTokens.subset(2);
    allowlistedTokens = allTokens.subset(2, 2);
  });

  sharedBeforeEach('deploy ProtocolFeesWithdrawer', async () => {
    protocolFeesWithdrawer = await deploy('ProtocolFeesWithdrawer', {
      args: [vault.address, denylistedTokens.addresses],
    });
  });

  sharedBeforeEach('grant permissions to allow/denylist tokens', async () => {
    const denylistTokenRole = await actionId(protocolFeesWithdrawer, 'denylistToken');
    const allowlistTokenRole = await actionId(protocolFeesWithdrawer, 'allowlistToken');
    await vault.grantPermissionsGlobally([denylistTokenRole, allowlistTokenRole], admin);
  });

  describe('constructor', () => {
    it('lists the initially denylisted tokens', async () => {
      expect(await protocolFeesWithdrawer.getDenylistedTokensLength()).to.be.eq(denylistedTokens.length);
      for (const [index, denylistedToken] of denylistedTokens.addresses.entries()) {
        expect(await protocolFeesWithdrawer.getDenylistedToken(index)).to.be.eq(denylistedToken);
      }
    });

    it('reports the initial denylisted tokens as ineligible for withdrawal', async () => {
      for (const denylistedToken of denylistedTokens.addresses) {
        expect(await protocolFeesWithdrawer.isWithdrawableToken(denylistedToken)).to.be.false;
      }
      expect(await protocolFeesWithdrawer.isWithdrawableTokens(denylistedTokens.addresses)).to.be.false;
    });
  });

  describe('denylistToken', () => {
    it('adds the token to the denylist', async () => {
      const newDenylistedToken = allowlistedTokens.first.address;

      expect(await protocolFeesWithdrawer.isWithdrawableToken(newDenylistedToken)).to.be.true;

      const oldDenylistLength = await protocolFeesWithdrawer.getDenylistedTokensLength();
      await protocolFeesWithdrawer.connect(admin).denylistToken(newDenylistedToken);
      const newDenylistLength = await protocolFeesWithdrawer.getDenylistedTokensLength();

      expect(newDenylistLength).to.be.eq(oldDenylistLength.add(1));
      expect(await protocolFeesWithdrawer.getDenylistedToken(newDenylistLength.sub(1))).to.be.eq(newDenylistedToken);
      expect(await protocolFeesWithdrawer.isWithdrawableToken(newDenylistedToken)).to.be.false;
    });

    it('emits an event', async () => {
      const newDenylistedToken = allowlistedTokens.first.address;
      const receipt = await (await protocolFeesWithdrawer.connect(admin).denylistToken(newDenylistedToken)).wait();

      expectEvent.inReceipt(receipt, 'TokenDenylisted', { token: newDenylistedToken });
    });

    it('reverts if already denylisted', async () => {
      await expect(
        protocolFeesWithdrawer.connect(admin).denylistToken(denylistedTokens.first.address)
      ).to.be.revertedWith('Token already denylisted');
    });
  });

  describe('allowlistToken', () => {
    it('removes the token from the denylist', async () => {
      const newAllowlistedToken = denylistedTokens.first.address;

      expect(await protocolFeesWithdrawer.isWithdrawableToken(newAllowlistedToken)).to.be.false;

      const oldDenylistLength = await protocolFeesWithdrawer.getDenylistedTokensLength();
      await protocolFeesWithdrawer.connect(admin).allowlistToken(newAllowlistedToken);
      const newDenylistLength = await protocolFeesWithdrawer.getDenylistedTokensLength();

      expect(newDenylistLength).to.be.eq(oldDenylistLength.sub(1));
      expect(await protocolFeesWithdrawer.isWithdrawableToken(newAllowlistedToken)).to.be.true;
    });

    it('emits an event', async () => {
      const newAllowlistedToken = denylistedTokens.first.address;
      const receipt = await (await protocolFeesWithdrawer.connect(admin).allowlistToken(newAllowlistedToken)).wait();

      expectEvent.inReceipt(receipt, 'TokenAllowlisted', { token: newAllowlistedToken });
    });

    it('reverts if not denylisted', async () => {
      await expect(
        protocolFeesWithdrawer.connect(admin).allowlistToken(allowlistedTokens.first.address)
      ).to.be.revertedWith('Token is not denylisted');
    });
  });

  describe('withdrawCollectedFees', () => {
    sharedBeforeEach('grant permissions to withdraw tokens', async () => {
      const unsafeWithdrawCollectedFeesRole = await actionId(protocolFeesCollector, 'withdrawCollectedFees');
      await vault.grantPermissionsGlobally([unsafeWithdrawCollectedFeesRole], protocolFeesWithdrawer);

      const safeWithdrawCollectedFeesRole = await actionId(protocolFeesWithdrawer, 'withdrawCollectedFees');
      await vault.grantPermissionsGlobally([safeWithdrawCollectedFeesRole], claimer);
    });

    sharedBeforeEach('deposit some tokens into the ProtocolFeeCollector', async () => {
      await allTokens.mint({ to: [protocolFeesCollector], amount: 100 });
    });

    context('when caller is authorized', () => {
      context('when attempting to claim allowlisted tokens', () => {
        it('withdraws the expected amount of tokens', async () => {
          const recipient = other;
          const expectedBalanceChanges = [
            {
              account: protocolFeesCollector,
              changes: allowlistedTokens.reduce((acc, token, amount) => {
                acc[token.symbol] = -amount;
                return acc;
              }, {} as Record<string, number>),
            },
            {
              account: recipient,
              changes: allowlistedTokens.reduce((acc, token, amount) => {
                acc[token.symbol] = amount;
                return acc;
              }, {} as Record<string, number>),
            },
          ];

          await expectBalanceChange(
            () =>
              protocolFeesWithdrawer.connect(claimer).withdrawCollectedFees(
                allowlistedTokens.addresses,
                allowlistedTokens.map((_, i) => i),
                recipient.address
              ),
            allowlistedTokens,
            expectedBalanceChanges
          );
        });
      });

      context('when attempting to claim denylisted tokens', () => {
        it('reverts', async () => {
          await expect(
            protocolFeesWithdrawer.connect(claimer).withdrawCollectedFees(
              denylistedTokens.addresses,
              denylistedTokens.map((_, i) => i),
              other.address
            )
          ).to.be.revertedWith('Attempting to withdraw denylisted token');
        });
      });

      context('when attempting to claim a mix of allowlisted and denylisted tokens', () => {
        it('reverts', async () => {
          await expect(
            protocolFeesWithdrawer.connect(claimer).withdrawCollectedFees(
              allTokens.addresses,
              allTokens.map((_, i) => i),
              other.address
            )
          ).to.be.revertedWith('Attempting to withdraw denylisted token');
        });
      });

      context('when tokens are later added from the denylist', () => {
        sharedBeforeEach('add tokens to denylist', async () => {
          for (const allowlistedToken of allowlistedTokens.addresses) {
            await protocolFeesWithdrawer.connect(admin).denylistToken(allowlistedToken);
          }
        });

        it('reverts', async () => {
          await expect(
            protocolFeesWithdrawer.connect(claimer).withdrawCollectedFees(
              allowlistedTokens.addresses,
              allowlistedTokens.map((_, i) => i),
              other.address
            )
          ).to.be.revertedWith('Attempting to withdraw denylisted token');
        });
      });

      context('when tokens are removed from the denylist', () => {
        sharedBeforeEach('remove tokens from denylist', async () => {
          for (const denylistedToken of denylistedTokens.addresses) {
            await protocolFeesWithdrawer.connect(admin).allowlistToken(denylistedToken);
          }
        });

        it('allows withdrawing these tokens', async () => {
          const recipient = other;
          const expectedBalanceChanges = [
            {
              account: protocolFeesCollector,
              changes: denylistedTokens.reduce((acc, token, amount) => {
                acc[token.symbol] = -amount;
                return acc;
              }, {} as Record<string, number>),
            },
            {
              account: recipient,
              changes: denylistedTokens.reduce((acc, token, amount) => {
                acc[token.symbol] = amount;
                return acc;
              }, {} as Record<string, number>),
            },
          ];

          await expectBalanceChange(
            () =>
              protocolFeesWithdrawer.connect(claimer).withdrawCollectedFees(
                denylistedTokens.addresses,
                denylistedTokens.map((_, i) => i),
                recipient.address
              ),
            denylistedTokens,
            expectedBalanceChanges
          );
        });
      });
    });

    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(
          protocolFeesWithdrawer.connect(other).withdrawCollectedFees(
            allowlistedTokens.addresses,
            allowlistedTokens.map((_, i) => i),
            other.address
          )
        ).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });
  });
});
