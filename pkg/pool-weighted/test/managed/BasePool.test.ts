import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { advanceTime, DAY, MONTH } from '@balancer-labs/v2-helpers/src/time';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { JoinPoolRequest, ExitPoolRequest, PoolSpecialization, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import { BigNumberish, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { ANY_ADDRESS, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import { random } from 'lodash';
import { defaultAbiCoder } from 'ethers/lib/utils';

describe('BasePool', function () {
  let admin: SignerWithAddress, poolOwner: SignerWithAddress, deployer: SignerWithAddress, other: SignerWithAddress;
  let authorizer: Contract, vault: Contract;
  let tokens: TokenList;

  const MIN_SWAP_FEE_PERCENTAGE = fp(0.000001);
  const DELEGATE_OWNER = '0xBA1BA1ba1BA1bA1bA1Ba1BA1ba1BA1bA1ba1ba1B';

  const PAUSE_WINDOW_DURATION = MONTH * 3;
  const BUFFER_PERIOD_DURATION = MONTH;

  before(async () => {
    [, admin, poolOwner, deployer, other] = await ethers.getSigners();
  });

  sharedBeforeEach(async () => {
    authorizer = await deploy('v2-vault/TimelockAuthorizer', { args: [admin.address, ZERO_ADDRESS, MONTH] });
    vault = await deploy('v2-vault/Vault', { args: [authorizer.address, ZERO_ADDRESS, 0, 0] });
    tokens = await TokenList.create(['DAI', 'MKR', 'SNX'], { sorted: true });
  });

  function deployBasePool(
    params: {
      tokens?: TokenList | string[];
      assetManagers?: string[];
      swapFeePercentage?: BigNumberish;
      pauseWindowDuration?: number;
      bufferPeriodDuration?: number;
      owner?: Account;
      from?: SignerWithAddress;
    } = {}
  ): Promise<Contract> {
    let {
      tokens: poolTokens,
      assetManagers,
      swapFeePercentage,
      pauseWindowDuration,
      bufferPeriodDuration,
      owner,
      from,
    } = params;
    if (!poolTokens) poolTokens = tokens;
    if (!assetManagers) assetManagers = Array(poolTokens.length).fill(ZERO_ADDRESS);
    if (!swapFeePercentage) swapFeePercentage = MIN_SWAP_FEE_PERCENTAGE;
    if (!pauseWindowDuration) pauseWindowDuration = MONTH;
    if (!bufferPeriodDuration) bufferPeriodDuration = 0;
    if (!owner) owner = ZERO_ADDRESS;
    if (!from) from = deployer;

    return deploy('v2-pool-weighted/MockBasePool', {
      from,
      args: [
        vault.address,
        PoolSpecialization.GeneralPool,
        'Balancer Pool Token',
        'BPT',
        Array.isArray(poolTokens) ? poolTokens : poolTokens.addresses,
        assetManagers,
        pauseWindowDuration,
        bufferPeriodDuration,
        TypesConverter.toAddress(owner),
      ],
    });
  }

  describe('authorizer', () => {
    let pool: Contract;

    sharedBeforeEach('deploy pool', async () => {
      pool = await deployBasePool();
    });

    it('uses the authorizer of the vault', async () => {
      expect(await pool.getAuthorizer()).to.equal(authorizer.address);
    });

    it('tracks authorizer changes in the vault', async () => {
      const action = await actionId(vault, 'setAuthorizer');
      await authorizer.connect(admin).grantPermissions([action], admin.address, [ANY_ADDRESS]);

      await vault.connect(admin).setAuthorizer(other.address);

      expect(await pool.getAuthorizer()).to.equal(other.address);
    });

    describe('action identifiers', () => {
      const selector = '0x12345678';

      context('with same pool creator', () => {
        it('pools share action identifiers', async () => {
          const pool = await deployBasePool({ tokens, from: deployer });
          const otherPool = await deployBasePool({ tokens, from: deployer });

          expect(await pool.getActionId(selector)).to.equal(await otherPool.getActionId(selector));
        });
      });

      context('with different pool creators', () => {
        it('pools have unique action identifiers', async () => {
          const pool = await deployBasePool({ tokens, from: deployer });
          const otherPool = await deployBasePool({ tokens, from: other });

          expect(await pool.getActionId(selector)).to.not.equal(await otherPool.getActionId(selector));
        });
      });
    });
  });

  describe('protocol fees', () => {
    let pool: Contract;

    sharedBeforeEach(async () => {
      pool = await deployBasePool();
    });

    it('skips zero value mints', async () => {
      const tx = await pool.payProtocolFees(0);

      expectEvent.notEmitted(await tx.wait(), 'Transfer');
    });

    it('mints bpt to the protocol fee collector', async () => {
      const feeCollector = await pool.getProtocolFeesCollector();

      const balanceBefore = await pool.balanceOf(feeCollector);
      await pool.payProtocolFees(fp(42));
      const balanceAfter = await pool.balanceOf(feeCollector);

      expect(balanceAfter.sub(balanceBefore)).to.equal(fp(42));
    });
  });

  describe('pause', () => {
    let pool: Contract;
    const PAUSE_WINDOW_DURATION = MONTH * 3;
    const BUFFER_PERIOD_DURATION = MONTH;

    let sender: SignerWithAddress;

    function itCanPause() {
      it('can pause', async () => {
        await pool.connect(sender).pause();

        const { paused } = await pool.getPausedState();
        expect(paused).to.be.true;
      });

      context('when paused', () => {
        let poolId: string;
        let initialBalances: BigNumber[];

        sharedBeforeEach('deploy and initialize pool', async () => {
          initialBalances = Array(tokens.length).fill(fp(1000));
          poolId = await pool.getPoolId();

          const request: JoinPoolRequest = {
            assets: tokens.addresses,
            maxAmountsIn: initialBalances,
            userData: WeightedPoolEncoder.joinInit(initialBalances),
            fromInternalBalance: false,
          };

          await tokens.mint({ to: poolOwner, amount: fp(1000 + random(1000)) });
          await tokens.approve({ from: poolOwner, to: vault });

          await vault.connect(poolOwner).joinPool(poolId, poolOwner.address, poolOwner.address, request);
        });

        sharedBeforeEach('pause pool', async () => {
          await pool.connect(sender).pause();
        });

        it('joins revert', async () => {
          const OTHER_JOIN_KIND = 1;

          const request: JoinPoolRequest = {
            assets: tokens.addresses,
            maxAmountsIn: Array(tokens.length).fill(0),
            userData: defaultAbiCoder.encode(['uint256'], [OTHER_JOIN_KIND]),
            fromInternalBalance: false,
          };

          await expect(
            vault.connect(poolOwner).joinPool(poolId, poolOwner.address, poolOwner.address, request)
          ).to.be.revertedWith('PAUSED');
        });

        it('exits revert', async () => {
          const OTHER_EXIT_KIND = 1;

          const request: ExitPoolRequest = {
            assets: tokens.addresses,
            minAmountsOut: Array(tokens.length).fill(0),
            userData: defaultAbiCoder.encode(['uint256'], [OTHER_EXIT_KIND]),
            toInternalBalance: false,
          };

          await expect(
            vault.connect(poolOwner).exitPool(poolId, poolOwner.address, poolOwner.address, request)
          ).to.be.revertedWith('PAUSED');
        });
      });

      it('can unpause', async () => {
        await pool.connect(sender).unpause();

        const { paused } = await pool.getPausedState();
        expect(paused).to.be.false;
      });

      it('cannot unpause after the pause window', async () => {
        await advanceTime(PAUSE_WINDOW_DURATION + DAY);
        await expect(pool.connect(sender).pause()).to.be.revertedWith('PAUSE_WINDOW_EXPIRED');
      });
    }

    function itRevertsWithUnallowedSender() {
      it('reverts', async () => {
        await expect(pool.connect(sender).pause()).to.be.revertedWith('SENDER_NOT_ALLOWED');
        await expect(pool.connect(sender).unpause()).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    }

    context('with a delegated owner', () => {
      const owner = DELEGATE_OWNER;

      sharedBeforeEach('deploy pool', async () => {
        pool = await deployBasePool({
          pauseWindowDuration: PAUSE_WINDOW_DURATION,
          bufferPeriodDuration: BUFFER_PERIOD_DURATION,
          owner,
        });
      });

      beforeEach('set sender', () => {
        sender = other;
      });

      context('when the sender does not have the pause permission in the authorizer', () => {
        itRevertsWithUnallowedSender();
      });

      context('when the sender has the pause permission in the authorizer', () => {
        sharedBeforeEach('grant permission', async () => {
          const pauseAction = await actionId(pool, 'pause');
          const unpauseAction = await actionId(pool, 'unpause');
          await authorizer
            .connect(admin)
            .grantPermissions([pauseAction, unpauseAction], sender.address, [ANY_ADDRESS, ANY_ADDRESS]);
        });

        itCanPause();
      });
    });

    context('with an owner', () => {
      let owner: SignerWithAddress;

      sharedBeforeEach('deploy pool', async () => {
        owner = poolOwner;
        pool = await deployBasePool({
          pauseWindowDuration: PAUSE_WINDOW_DURATION,
          bufferPeriodDuration: BUFFER_PERIOD_DURATION,
          owner,
        });
      });

      context('when the sender is the owner', () => {
        beforeEach('set sender', () => {
          sender = owner;
        });

        itRevertsWithUnallowedSender();
      });

      context('when the sender is not the owner', () => {
        beforeEach('set sender', () => {
          sender = other;
        });

        context('when the sender does not have the pause permission in the authorizer', () => {
          itRevertsWithUnallowedSender();
        });

        context('when the sender has the pause permission in the authorizer', () => {
          sharedBeforeEach(async () => {
            const pauseAction = await actionId(pool, 'pause');
            const unpauseAction = await actionId(pool, 'unpause');
            await authorizer
              .connect(admin)
              .grantPermissions([pauseAction, unpauseAction], sender.address, [ANY_ADDRESS, ANY_ADDRESS]);
          });

          itCanPause();
        });
      });
    });
  });

  describe('recovery mode', () => {
    let pool: Contract;
    let sender: SignerWithAddress;

    function itCanEnableRecoveryMode() {
      it('can enable recovery mode', async () => {
        await pool.connect(sender).enableRecoveryMode();

        const recoveryMode = await pool.inRecoveryMode();
        expect(recoveryMode).to.be.true;
      });

      it('can disable recovery mode', async () => {
        await pool.connect(sender).enableRecoveryMode();
        await pool.connect(sender).disableRecoveryMode();

        const recoveryMode = await pool.inRecoveryMode();
        expect(recoveryMode).to.be.false;
      });
    }

    function itRevertsWithUnallowedSender() {
      it('reverts', async () => {
        await expect(pool.connect(sender).enableRecoveryMode()).to.be.revertedWith('SENDER_NOT_ALLOWED');
        await expect(pool.connect(sender).disableRecoveryMode()).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    }

    context('with a delegated owner', () => {
      const owner = DELEGATE_OWNER;

      sharedBeforeEach('deploy pool', async () => {
        pool = await deployBasePool({
          pauseWindowDuration: PAUSE_WINDOW_DURATION,
          bufferPeriodDuration: BUFFER_PERIOD_DURATION,
          owner,
        });
      });

      beforeEach('set sender', () => {
        sender = other;
      });

      context('when the sender does not have the recovery mode permission in the authorizer', () => {
        itRevertsWithUnallowedSender();
      });

      context('when the sender has the recovery mode permission in the authorizer', () => {
        sharedBeforeEach('grant permission', async () => {
          const enableRecoveryAction = await actionId(pool, 'enableRecoveryMode');
          const disableRecoveryAction = await actionId(pool, 'disableRecoveryMode');
          await authorizer
            .connect(admin)
            .grantPermissions([enableRecoveryAction, disableRecoveryAction], sender.address, [
              ANY_ADDRESS,
              ANY_ADDRESS,
            ]);
        });

        itCanEnableRecoveryMode();
      });
    });

    context('with an owner', () => {
      let owner: SignerWithAddress;

      sharedBeforeEach('deploy pool', async () => {
        owner = poolOwner;
        pool = await deployBasePool({
          pauseWindowDuration: PAUSE_WINDOW_DURATION,
          bufferPeriodDuration: BUFFER_PERIOD_DURATION,
          owner,
        });
      });

      context('when the sender is the owner', () => {
        beforeEach('set sender', () => {
          sender = owner;
        });

        itRevertsWithUnallowedSender();
      });

      context('when the sender is not the owner', () => {
        beforeEach('set sender', () => {
          sender = other;
        });

        context('when the sender does not have the recovery mode permission in the authorizer', () => {
          itRevertsWithUnallowedSender();
        });

        context('when the sender has the recovery mode permission in the authorizer', () => {
          sharedBeforeEach('grant permission', async () => {
            const enableRecoveryAction = await actionId(pool, 'enableRecoveryMode');
            const disableRecoveryAction = await actionId(pool, 'disableRecoveryMode');
            await authorizer
              .connect(admin)
              .grantPermissions([enableRecoveryAction, disableRecoveryAction], sender.address, [
                ANY_ADDRESS,
                ANY_ADDRESS,
              ]);
          });

          itCanEnableRecoveryMode();
        });
      });
    });

    context('exit', () => {
      const RECOVERY_MODE_EXIT_KIND = 255;
      let poolId: string;
      let initialBalances: BigNumber[];
      let pool: Contract;

      let sender: SignerWithAddress;
      let recipient: SignerWithAddress;

      let normalJoin: () => Promise<ContractReceipt>;
      let normalExit: () => Promise<ContractReceipt>;

      const PROTOCOL_SWAP_FEE_PERCENTAGE = fp(0.3);
      const OTHER_EXIT_KIND = 1;
      const OTHER_JOIN_KIND = 1;

      before('prepare normal join and exit', () => {
        sender = poolOwner;
        recipient = poolOwner;

        const joinRequest: JoinPoolRequest = {
          assets: tokens.addresses,
          maxAmountsIn: Array(tokens.length).fill(0),
          userData: defaultAbiCoder.encode(['uint256'], [OTHER_JOIN_KIND]),
          fromInternalBalance: false,
        };

        normalJoin = async () =>
          (await vault.connect(sender).joinPool(poolId, sender.address, recipient.address, joinRequest)).wait();

        const exitRequest: ExitPoolRequest = {
          assets: tokens.addresses,
          minAmountsOut: Array(tokens.length).fill(0),
          userData: defaultAbiCoder.encode(['uint256'], [OTHER_EXIT_KIND]),
          toInternalBalance: false,
        };

        normalExit = async () =>
          (await vault.connect(sender).exitPool(poolId, sender.address, recipient.address, exitRequest)).wait();
      });

      sharedBeforeEach('deploy and initialize pool', async () => {
        initialBalances = Array(tokens.length).fill(fp(1000));
        pool = await deployBasePool({ pauseWindowDuration: MONTH });
        poolId = await pool.getPoolId();

        const request: JoinPoolRequest = {
          assets: tokens.addresses,
          maxAmountsIn: initialBalances,
          userData: WeightedPoolEncoder.joinInit(initialBalances),
          fromInternalBalance: false,
        };

        await tokens.mint({ to: poolOwner, amount: fp(1000 + random(1000)) });
        await tokens.approve({ from: poolOwner, to: vault });

        await vault.connect(sender).joinPool(poolId, sender.address, recipient.address, request);
      });

      sharedBeforeEach('set a non-zero protocol swap fee percentage', async () => {
        const feesCollector = await deployedAt(
          'v2-vault/ProtocolFeesCollector',
          await vault.getProtocolFeesCollector()
        );

        await authorizer
          .connect(admin)
          .grantPermissions([await actionId(feesCollector, 'setSwapFeePercentage')], admin.address, [ANY_ADDRESS]);

        await feesCollector.connect(admin).setSwapFeePercentage(PROTOCOL_SWAP_FEE_PERCENTAGE);

        expect(await feesCollector.getSwapFeePercentage()).to.equal(PROTOCOL_SWAP_FEE_PERCENTAGE);
      });

      context('when not in recovery mode', () => {
        it('the recovery mode exit reverts', async () => {
          const preExitBPT = await pool.balanceOf(sender.address);
          const exitBPT = preExitBPT.div(3);

          const request: ExitPoolRequest = {
            assets: tokens.addresses,
            minAmountsOut: Array(tokens.length).fill(0),
            userData: defaultAbiCoder.encode(['uint256', 'uint256'], [RECOVERY_MODE_EXIT_KIND, exitBPT]),
            toInternalBalance: false,
          };

          await expect(
            vault.connect(sender).exitPool(poolId, sender.address, recipient.address, request)
          ).to.be.revertedWith('NOT_IN_RECOVERY_MODE');
        });

        // TODO: refactor normal joins / exits.
        describe('normal joins', () => {
          it('do not revert', async () => {
            await expect(normalJoin()).to.not.be.reverted;
          });

          it('calls inner onJoin hook with join parameters', async () => {
            const receipt = await normalJoin();
            expectEvent.inIndirectReceipt(receipt, pool.interface, 'InnerOnJoinPoolCalled', {
              sender: sender.address,
              balances: initialBalances,
              userData: defaultAbiCoder.encode(['uint256'], [OTHER_JOIN_KIND]),
            });
          });
        });

        // TODO: refactor normal joins / exits.
        describe('normal exits', () => {
          it('do not revert', async () => {
            await expect(normalExit()).to.not.be.reverted;
          });

          it('calls inner onExit hook with exit parameters', async () => {
            const receipt = await normalExit();
            expectEvent.inIndirectReceipt(receipt, pool.interface, 'InnerOnExitPoolCalled', {
              sender: sender.address,
              balances: initialBalances,
              userData: defaultAbiCoder.encode(['uint256'], [OTHER_EXIT_KIND]),
            });
          });
        });
      });

      context('when in recovery mode', () => {
        sharedBeforeEach('enable recovery mode', async () => {
          const enableRecoveryAction = await actionId(pool, 'enableRecoveryMode');
          const disableRecoveryAction = await actionId(pool, 'disableRecoveryMode');
          await authorizer
            .connect(admin)
            .grantPermissions([enableRecoveryAction, disableRecoveryAction], admin.address, [ANY_ADDRESS, ANY_ADDRESS]);

          await pool.connect(admin).enableRecoveryMode();
        });

        // TODO: refactor normal joins / exits.
        describe('normal joins', () => {
          it('do not revert', async () => {
            await expect(normalJoin()).to.not.be.reverted;
          });

          it('calls inner onJoin hook with join parameters', async () => {
            const receipt = await normalJoin();
            expectEvent.inIndirectReceipt(receipt, pool.interface, 'InnerOnJoinPoolCalled', {
              sender: sender.address,
              balances: initialBalances,
              userData: defaultAbiCoder.encode(['uint256'], [OTHER_JOIN_KIND]),
            });
          });
        });

        // TODO: refactor normal joins / exits.
        describe('normal exits', () => {
          it('do not revert', async () => {
            await expect(normalExit()).to.not.be.reverted;
          });

          it('calls inner onExit hook with exit parameters', async () => {
            const receipt = await normalExit();
            expectEvent.inIndirectReceipt(receipt, pool.interface, 'InnerOnExitPoolCalled', {
              sender: sender.address,
              balances: initialBalances,
              userData: defaultAbiCoder.encode(['uint256'], [OTHER_EXIT_KIND]),
            });
          });
        });

        function itExitsViaRecoveryModeCorrectly() {
          it('the recovery mode exit can be used', async () => {
            const preExitBPT = await pool.balanceOf(sender.address);
            const exitBPT = preExitBPT.div(3);

            const request: ExitPoolRequest = {
              assets: tokens.addresses,
              minAmountsOut: Array(tokens.length).fill(0),
              userData: defaultAbiCoder.encode(['uint256', 'uint256'], [RECOVERY_MODE_EXIT_KIND, exitBPT]),
              toInternalBalance: false,
            };

            // The sole BPT holder is the owner, so they own the initial balances
            const expectedChanges = tokens.reduce(
              (changes, token, i) => ({ ...changes, [token.symbol]: ['very-near', initialBalances[i].div(3)] }),
              {}
            );
            await expectBalanceChange(
              () => vault.connect(sender).exitPool(poolId, sender.address, recipient.address, request),
              tokens,
              { account: recipient, changes: expectedChanges }
            );

            // Exit BPT was burned
            const afterExitBalance = await pool.balanceOf(sender.address);
            expect(afterExitBalance).to.equal(preExitBPT.sub(exitBPT));
          });
        }

        itExitsViaRecoveryModeCorrectly();

        context('when paused', () => {
          sharedBeforeEach('pause pool', async () => {
            await authorizer
              .connect(admin)
              .grantPermissions([await actionId(pool, 'pause')], admin.address, [ANY_ADDRESS]);

            await pool.connect(admin).pause();
          });

          itExitsViaRecoveryModeCorrectly();
        });
      });
    });
  });
});
