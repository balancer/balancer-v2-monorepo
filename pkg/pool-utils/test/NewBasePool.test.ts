import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { expectTransferEvent } from '@balancer-labs/v2-helpers/src/test/expectTransfer';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { advanceTime, MONTH } from '@balancer-labs/v2-helpers/src/time';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import {
  JoinPoolRequest,
  ExitPoolRequest,
  SwapRequest,
  PoolSpecialization,
  WeightedPoolEncoder,
  SingleSwap,
  SwapKind,
  FundManagement,
} from '@balancer-labs/balancer-js';
import { BigNumberish, bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { ANY_ADDRESS, DELEGATE_OWNER, MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';
import { random } from 'lodash';
import { defaultAbiCoder } from 'ethers/lib/utils';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { impersonateAccount, setBalance } from '@nomicfoundation/hardhat-network-helpers';

describe('NewBasePool', function () {
  let admin: SignerWithAddress,
    poolOwner: SignerWithAddress,
    deployer: SignerWithAddress,
    other: SignerWithAddress,
    vaultSigner: SignerWithAddress;

  let authorizer: Contract, vault: Contract;
  let tokens: TokenList;

  const MIN_SWAP_FEE_PERCENTAGE = fp(0.000001);

  const PAUSE_WINDOW_DURATION = MONTH * 3;
  const BUFFER_PERIOD_DURATION = MONTH;

  before(async () => {
    [, admin, poolOwner, deployer, other] = await ethers.getSigners();
  });

  sharedBeforeEach(async () => {
    ({ instance: vault, authorizer } = await Vault.create({ admin }));

    // We want to call Pools manually from the Vault address for some tests, so we impersonate the Vault and send it
    // some ETH in order to be able to have it send transactions.
    await impersonateAccount(vault.address);
    await setBalance(vault.address, fp(100));
    vaultSigner = await SignerWithAddress.create(ethers.provider.getSigner(vault.address));

    tokens = await TokenList.create(['DAI', 'MKR', 'SNX'], { sorted: true });
  });

  function deployBasePool(
    params: {
      specialization?: PoolSpecialization;
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
      specialization,
      tokens: poolTokens,
      assetManagers,
      swapFeePercentage,
      pauseWindowDuration,
      bufferPeriodDuration,
      owner,
      from,
    } = params;
    if (!specialization) specialization = PoolSpecialization.GeneralPool;
    if (!poolTokens) poolTokens = tokens;
    if (!assetManagers) assetManagers = Array(poolTokens.length).fill(ZERO_ADDRESS);
    if (!swapFeePercentage) swapFeePercentage = MIN_SWAP_FEE_PERCENTAGE;
    if (!pauseWindowDuration) pauseWindowDuration = 0;
    if (!bufferPeriodDuration) bufferPeriodDuration = 0;
    if (!owner) owner = ZERO_ADDRESS;
    if (!from) from = deployer;

    return deploy('MockNewBasePool', {
      from,
      args: [
        vault.address,
        specialization,
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

  describe('only vault modifier', () => {
    let pool: Contract;
    let poolId: string;

    sharedBeforeEach(async () => {
      pool = await deployBasePool();
      poolId = await pool.getPoolId();
    });

    context('when caller is vault', () => {
      it('does not revert with the correct pool ID', async () => {
        await expect(pool.connect(vaultSigner).onlyVaultCallable(poolId)).to.not.be.reverted;
      });

      it('reverts with any pool ID', async () => {
        await expect(pool.connect(vaultSigner).onlyVaultCallable(ethers.utils.randomBytes(32))).to.be.revertedWith(
          'INVALID_POOL_ID'
        );
      });
    });

    context('when caller is other', () => {
      it('reverts with the correct pool ID', async () => {
        await expect(pool.connect(other).onlyVaultCallable(poolId)).to.be.revertedWith('CALLER_NOT_VAULT');
      });

      it('reverts with any pool ID', async () => {
        await expect(pool.connect(other).onlyVaultCallable(ethers.utils.randomBytes(32))).to.be.revertedWith(
          'CALLER_NOT_VAULT'
        );
      });
    });
  });

  describe('authorizer', () => {
    let pool: Contract;

    sharedBeforeEach(async () => {
      pool = await deployBasePool();
    });

    it('uses the authorizer of the vault', async () => {
      expect(await pool.getAuthorizer()).to.equal(authorizer.address);
    });

    it('tracks authorizer changes in the vault', async () => {
      const action = await actionId(vault, 'setAuthorizer');
      await authorizer.connect(admin).grantPermission(action, admin.address, ANY_ADDRESS);

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

    it('shares protocol fees collector with the vault', async () => {
      expect(await pool.getProtocolFeesCollector()).to.be.eq(await vault.getProtocolFeesCollector());
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
    let pool: Contract, minimalPool: Contract;
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
        let poolId: string, minimalPoolId: string;
        let initialBalances: BigNumber[];

        sharedBeforeEach('deploy and initialize pool', async () => {
          const initialBalancePerToken = 1000;
          initialBalances = Array(tokens.length).fill(fp(initialBalancePerToken));
          poolId = await pool.getPoolId();
          minimalPoolId = await minimalPool.getPoolId();

          const request: JoinPoolRequest = {
            assets: tokens.addresses,
            maxAmountsIn: initialBalances,
            userData: WeightedPoolEncoder.joinInit(initialBalances),
            fromInternalBalance: false,
          };

          await tokens.mint({ to: poolOwner, amount: fp(2 * initialBalancePerToken + random(1000)) });
          await tokens.approve({ from: poolOwner, to: vault });

          await vault.connect(poolOwner).joinPool(poolId, poolOwner.address, poolOwner.address, request);
          await vault.connect(poolOwner).joinPool(minimalPoolId, poolOwner.address, poolOwner.address, request);
        });

        sharedBeforeEach('pause pool', async () => {
          await pool.connect(sender).pause();
          await minimalPool.connect(sender).pause();
        });

        it('swaps revert in general pool', async () => {
          const singleSwap: SingleSwap = {
            poolId,
            kind: SwapKind.GivenIn,
            assetIn: tokens.get(0).instance.address,
            assetOut: tokens.get(1).instance.address,
            amount: 1, // Needs to be > 0
            userData: '0x',
          };

          const funds: FundManagement = {
            sender: poolOwner.address,
            recipient: poolOwner.address,
            fromInternalBalance: false,
            toInternalBalance: false,
          };

          // min amount: 0, deadline: max.
          await expect(vault.connect(poolOwner).swap(singleSwap, funds, 0, MAX_UINT256)).to.be.revertedWith('PAUSED');
        });

        it('swaps revert in minimal pool', async () => {
          const singleSwap: SingleSwap = {
            poolId: minimalPoolId,
            kind: SwapKind.GivenIn,
            assetIn: tokens.get(0).instance.address,
            assetOut: tokens.get(1).instance.address,
            amount: 1, // Needs to be > 0
            userData: '0x',
          };

          const funds: FundManagement = {
            sender: poolOwner.address,
            recipient: poolOwner.address,
            fromInternalBalance: false,
            toInternalBalance: false,
          };

          // min amount: 0, deadline: max.
          await expect(vault.connect(poolOwner).swap(singleSwap, funds, 0, MAX_UINT256)).to.be.revertedWith('PAUSED');
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
        await advanceTime(PAUSE_WINDOW_DURATION + 1);
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

      sharedBeforeEach('deploy pools', async () => {
        pool = await deployBasePool({
          pauseWindowDuration: PAUSE_WINDOW_DURATION,
          bufferPeriodDuration: BUFFER_PERIOD_DURATION,
          owner,
        });

        minimalPool = await deployBasePool({
          specialization: PoolSpecialization.MinimalSwapInfoPool,
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
          if (!(await authorizer.hasPermission(unpauseAction, sender.address, ANY_ADDRESS))) {
            await authorizer.connect(admin).grantPermission(unpauseAction, sender.address, ANY_ADDRESS);
          }
          if (!(await authorizer.hasPermission(pauseAction, sender.address, ANY_ADDRESS))) {
            await authorizer.connect(admin).grantPermission(pauseAction, sender.address, ANY_ADDRESS);
          }
          if (!(await authorizer.hasPermission(await actionId(minimalPool, 'pause'), sender.address, ANY_ADDRESS))) {
            await authorizer
              .connect(admin)
              .grantPermission(await actionId(minimalPool, 'pause'), sender.address, ANY_ADDRESS);
          }
        });

        itCanPause();
      });
    });

    context('with an owner', () => {
      let owner: SignerWithAddress;

      sharedBeforeEach('deploy pools', async () => {
        owner = poolOwner;
        pool = await deployBasePool({
          pauseWindowDuration: PAUSE_WINDOW_DURATION,
          bufferPeriodDuration: BUFFER_PERIOD_DURATION,
          owner,
        });

        minimalPool = await deployBasePool({
          specialization: PoolSpecialization.MinimalSwapInfoPool,
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
          sharedBeforeEach('grant permission', async () => {
            const pauseAction = await actionId(pool, 'pause');
            const unpauseAction = await actionId(pool, 'unpause');
            await authorizer.connect(admin).grantPermission(pauseAction, sender.address, ANY_ADDRESS);
            await authorizer.connect(admin).grantPermission(unpauseAction, sender.address, ANY_ADDRESS);
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

      sharedBeforeEach(async () => {
        pool = await deployBasePool({
          pauseWindowDuration: PAUSE_WINDOW_DURATION,
          bufferPeriodDuration: BUFFER_PERIOD_DURATION,
          owner,
        });
      });

      beforeEach('set sender', () => {
        sender = other;
      });

      it('stores the vault (in RecoveryMode contract)', async () => {
        expect(await pool.vault()).to.equal(vault.address);
      });

      context('when the sender does not have the recovery mode permission in the authorizer', () => {
        itRevertsWithUnallowedSender();
      });

      context('when the sender has the recovery mode permission in the authorizer', () => {
        sharedBeforeEach('grant permission', async () => {
          const enableRecoveryAction = await actionId(pool, 'enableRecoveryMode');
          const disableRecoveryAction = await actionId(pool, 'disableRecoveryMode');
          await authorizer.connect(admin).grantPermission(disableRecoveryAction, sender.address, ANY_ADDRESS);
          await authorizer.connect(admin).grantPermission(enableRecoveryAction, sender.address, ANY_ADDRESS);
        });

        itCanEnableRecoveryMode();
      });
    });

    context('with an owner', () => {
      let owner: SignerWithAddress;

      sharedBeforeEach(async () => {
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
            await authorizer.connect(admin).grantPermission(enableRecoveryAction, sender.address, ANY_ADDRESS);
            await authorizer.connect(admin).grantPermission(disableRecoveryAction, sender.address, ANY_ADDRESS);
          });

          itCanEnableRecoveryMode();
        });
      });
    });
  });

  describe('swap join exit', () => {
    const RECOVERY_MODE_EXIT_KIND = 255;
    let pool: Contract, minimalPool: Contract;
    let poolId: string, minimalPoolId: string;
    let initialBalances: BigNumber[];

    let sender: SignerWithAddress, recipient: SignerWithAddress;

    let normalSwap: (singleSwap: SingleSwap) => Promise<ContractReceipt>;
    let normalJoin: () => Promise<ContractReceipt>;
    let normalExit: () => Promise<ContractReceipt>;

    const PROTOCOL_SWAP_FEE_PERCENTAGE = fp(0.3);
    const OTHER_EXIT_KIND = 1;
    const OTHER_JOIN_KIND = 1;

    sharedBeforeEach('deploy and initialize pool', async () => {
      sender = poolOwner;
      recipient = poolOwner;
      const initialBalancePerToken = 1000;

      initialBalances = Array(tokens.length).fill(fp(initialBalancePerToken));
      pool = await deployBasePool({ pauseWindowDuration: MONTH });
      poolId = await pool.getPoolId();

      minimalPool = await deployBasePool({
        pauseWindowDuration: MONTH,
        specialization: PoolSpecialization.MinimalSwapInfoPool,
      });
      minimalPoolId = await minimalPool.getPoolId();

      const request: JoinPoolRequest = {
        assets: tokens.addresses,
        maxAmountsIn: initialBalances,
        userData: WeightedPoolEncoder.joinInit(initialBalances),
        fromInternalBalance: false,
      };

      // We mint twice the initial pool balance to fund two pools.
      await tokens.mint({ to: sender, amount: fp(2 * initialBalancePerToken + random(1000)) });
      await tokens.approve({ from: sender, to: vault });

      await vault.connect(sender).joinPool(poolId, sender.address, recipient.address, request);
      await vault.connect(sender).joinPool(minimalPoolId, sender.address, recipient.address, request);
    });

    sharedBeforeEach('prepare normal swaps', () => {
      const funds: FundManagement = {
        sender: poolOwner.address,
        recipient: poolOwner.address,
        fromInternalBalance: false,
        toInternalBalance: false,
      };

      // min amount: 0, deadline: max.
      normalSwap = async (singleSwap: SingleSwap) =>
        (await vault.connect(sender).swap(singleSwap, funds, 0, MAX_UINT256)).wait();
    });

    sharedBeforeEach('prepare normal join and exit', () => {
      const joinRequest: JoinPoolRequest = {
        assets: tokens.addresses,
        maxAmountsIn: Array(tokens.length).fill(fp(1)),
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

    sharedBeforeEach('set a non-zero protocol swap fee percentage', async () => {
      const feesCollector = await deployedAt('v2-vault/ProtocolFeesCollector', await vault.getProtocolFeesCollector());

      await authorizer
        .connect(admin)
        .grantPermission(await actionId(feesCollector, 'setSwapFeePercentage'), admin.address, ANY_ADDRESS);

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

      itSwaps();

      itJoins();

      itExits();
    });

    context('when in recovery mode', () => {
      sharedBeforeEach('enable recovery mode', async () => {
        const enableRecoveryAction = await actionId(pool, 'enableRecoveryMode');
        const disableRecoveryAction = await actionId(pool, 'disableRecoveryMode');
        await authorizer.connect(admin).grantPermission(enableRecoveryAction, admin.address, ANY_ADDRESS);

        await authorizer.connect(admin).grantPermission(disableRecoveryAction, admin.address, ANY_ADDRESS);

        await pool.connect(admin).enableRecoveryMode();
      });

      itSwaps();

      itJoins();

      itExits();

      function itExitsViaRecoveryModeCorrectly() {
        let request: ExitPoolRequest;
        let preExitBPT: BigNumber, exitBPT: BigNumber;

        sharedBeforeEach(async () => {
          preExitBPT = await pool.balanceOf(sender.address);
          exitBPT = preExitBPT.div(3);

          request = {
            assets: tokens.addresses,
            minAmountsOut: Array(tokens.length).fill(0),
            userData: defaultAbiCoder.encode(['uint256', 'uint256'], [RECOVERY_MODE_EXIT_KIND, exitBPT]),
            toInternalBalance: false,
          };
        });

        it('passes the correct arguments to `_doRecoveryModeExit`', async () => {
          const totalSupply = await pool.totalSupply();
          const tx = await vault.connect(sender).exitPool(poolId, sender.address, recipient.address, request);
          expectEvent.inIndirectReceipt(await tx.wait(), pool.interface, 'RecoveryModeExit', {
            totalSupply,
            balances: initialBalances,
            bptAmountIn: exitBPT,
          });
        });

        it('burns the expected amount of BPT', async () => {
          await vault.connect(sender).exitPool(poolId, sender.address, recipient.address, request);

          const afterExitBalance = await pool.balanceOf(sender.address);
          expect(afterExitBalance).to.equal(preExitBPT.sub(exitBPT));
        });

        it('returns 0 due protocol fees', async () => {
          const onExitReturn = await pool
            .connect(vaultSigner)
            .callStatic.onExitPool(poolId, sender.address, recipient.address, initialBalances, 0, 0, request.userData);

          expect(onExitReturn.length).to.be.eq(2);
          expect(onExitReturn[1]).to.deep.eq(Array(tokens.length).fill(bn(0)));
        });
      }

      itExitsViaRecoveryModeCorrectly();

      context('when paused', () => {
        sharedBeforeEach('pause pool', async () => {
          await authorizer.connect(admin).grantPermission(await actionId(pool, 'pause'), admin.address, ANY_ADDRESS);

          await pool.connect(admin).pause();
        });

        itExitsViaRecoveryModeCorrectly();
      });
    });

    function itSwaps() {
      let singleSwap: SingleSwap;
      let swapRequest: SwapRequest;

      describe('minimal swaps', () => {
        sharedBeforeEach('prepare swap request', async () => {
          singleSwap = {
            poolId: minimalPoolId,
            kind: SwapKind.GivenIn,
            assetIn: tokens.get(0).instance.address,
            assetOut: tokens.get(1).instance.address,
            amount: 1, // Needs to be > 0
            userData: '0xdeadbeef',
          };

          const lastChangeBlock = (await vault.getPoolTokens(minimalPoolId)).lastChangeBlock;
          swapRequest = {
            kind: singleSwap.kind,
            tokenIn: singleSwap.assetIn,
            tokenOut: singleSwap.assetOut,
            amount: singleSwap.amount,
            poolId: singleSwap.poolId,
            lastChangeBlock: lastChangeBlock,
            from: sender.address,
            to: recipient.address,
            userData: singleSwap.userData,
          };
        });

        it('do not revert', async () => {
          await expect(normalSwap(singleSwap)).to.not.be.reverted;
        });

        it('calls inner onSwapMinimal hook with swap parameters', async () => {
          const receipt = await normalSwap(singleSwap);

          expectEvent.inIndirectReceipt(receipt, minimalPool.interface, 'InnerOnSwapMinimalCalled', {
            request: Object.values(swapRequest),
            balanceTokenIn: initialBalances[0],
            balanceTokenOut: initialBalances[1],
          });
        });

        it('returns the output of the inner onSwapMinimal hook', async () => {
          const onSwap =
            'onSwap((uint8,address,address,uint256,bytes32,uint256,address,address,bytes),uint256,uint256)';
          const onSwapReturn = await minimalPool.connect(vaultSigner).callStatic[onSwap](swapRequest, 0, 0);
          expect(onSwapReturn).to.be.eq(await minimalPool.ON_SWAP_MINIMAL_RETURN());
        });

        it('reverts if swap hook caller is not the vault', async () => {
          const onSwap =
            'onSwap((uint8,address,address,uint256,bytes32,uint256,address,address,bytes),uint256,uint256)';
          await expect(minimalPool.connect(other)[onSwap](swapRequest, 0, 0)).to.be.revertedWith('CALLER_NOT_VAULT');
        });
      });

      describe('general swaps', () => {
        sharedBeforeEach('prepare swap request', async () => {
          singleSwap = {
            poolId,
            kind: SwapKind.GivenIn,
            assetIn: tokens.get(1).instance.address,
            assetOut: tokens.get(2).instance.address,
            amount: 1, // Needs to be > 0
            userData: '0xdeadbeef',
          };

          const lastChangeBlock = (await vault.getPoolTokens(poolId)).lastChangeBlock;
          swapRequest = {
            kind: singleSwap.kind,
            tokenIn: singleSwap.assetIn,
            tokenOut: singleSwap.assetOut,
            amount: singleSwap.amount,
            poolId: singleSwap.poolId,
            lastChangeBlock: lastChangeBlock,
            from: sender.address,
            to: recipient.address,
            userData: singleSwap.userData,
          };
        });

        it('do not revert', async () => {
          await expect(normalSwap(singleSwap)).to.not.be.reverted;
        });

        it('calls inner onSwapGeneral hook with swap parameters', async () => {
          const receipt = await normalSwap(singleSwap);

          expectEvent.inIndirectReceipt(receipt, pool.interface, 'InnerOnSwapGeneralCalled', {
            request: Object.values(swapRequest),
            balances: initialBalances,
            indexIn: 1,
            indexOut: 2,
          });
        });

        it('returns the output of the inner onSwapGeneral hook', async () => {
          const onSwap =
            'onSwap((uint8,address,address,uint256,bytes32,uint256,address,address,bytes),uint256[],uint256,uint256)';
          const onSwapReturn = await pool.connect(vaultSigner).callStatic[onSwap](swapRequest, [], 0, 0);
          expect(onSwapReturn).to.be.eq(await pool.ON_SWAP_GENERAL_RETURN());
        });

        it('reverts if swap hook caller is not the vault', async () => {
          const onSwap =
            'onSwap((uint8,address,address,uint256,bytes32,uint256,address,address,bytes),uint256[],uint256,uint256)';
          await expect(minimalPool.connect(other)[onSwap](swapRequest, [], 0, 0)).to.be.revertedWith(
            'CALLER_NOT_VAULT'
          );
        });
      });
    }

    function itJoins() {
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

        it('returns the output of the inner onJoin hook and 0 due protocol fees', async () => {
          const onJoinReturn = await pool
            .connect(vaultSigner)
            .callStatic.onJoinPool(poolId, sender.address, recipient.address, initialBalances, 0, 0, '0x');
          expect(onJoinReturn).to.be.deep.eq([
            Array(tokens.length).fill(await pool.ON_JOIN_RETURN()),
            Array(tokens.length).fill(bn(0)),
          ]);
        });
      });
    }

    function itExits() {
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

        it('returns the output of the inner onExit hook and 0 due protocol fees', async () => {
          const onExitReturn = await pool
            .connect(vaultSigner)
            .callStatic.onExitPool(poolId, sender.address, recipient.address, initialBalances, 0, 0, '0x');
          expect(onExitReturn).to.be.deep.eq([
            Array(tokens.length).fill(await pool.ON_EXIT_RETURN()),
            Array(tokens.length).fill(bn(0)),
          ]);
        });
      });
    }
  });

  describe('pool initialization', () => {
    let pool: Contract;
    let sender: SignerWithAddress, recipient: SignerWithAddress;
    let poolId: string, userData: string;
    let request: JoinPoolRequest;
    let initialBalances: Array<BigNumber>;

    sharedBeforeEach('set up pool and initial join request', async () => {
      sender = poolOwner;
      recipient = other;
      pool = await deployBasePool({
        pauseWindowDuration: PAUSE_WINDOW_DURATION,
      });
      poolId = await pool.getPoolId();

      const initialBalancePerToken = 1000;

      await tokens.mint({ to: sender, amount: fp(initialBalancePerToken) });
      await tokens.approve({ from: sender, to: vault });

      initialBalances = Array(tokens.length).fill(fp(initialBalancePerToken));
      userData = WeightedPoolEncoder.joinInit(initialBalances);
      request = {
        assets: tokens.addresses,
        maxAmountsIn: initialBalances,
        userData,
        fromInternalBalance: false,
      };
    });

    context('when paused', () => {
      sharedBeforeEach(async () => {
        await authorizer.connect(admin).grantPermission(await actionId(pool, 'pause'), sender.address, ANY_ADDRESS);
        await pool.connect(sender).pause();
      });

      it('reverts', async () => {
        await expect(
          vault.connect(sender).joinPool(poolId, sender.address, recipient.address, request)
        ).to.be.revertedWith('PAUSED');
      });
    });

    context('when not paused', () => {
      it('calls inner initialization hook', async () => {
        const receipt = await (
          await vault.connect(sender).joinPool(poolId, sender.address, recipient.address, request)
        ).wait();

        expectEvent.inIndirectReceipt(receipt, pool.interface, 'InnerOnInitializePoolCalled', {
          userData,
        });
      });

      it('locks the minimum bpt in the zero address', async () => {
        const receipt = await (
          await vault.connect(sender).joinPool(poolId, sender.address, recipient.address, request)
        ).wait();

        expectTransferEvent(receipt, { from: ZERO_ADDRESS, to: ZERO_ADDRESS, value: await pool.getMinimumBpt() }, pool);
      });

      it('mints bpt to recipient', async () => {
        const receipt = await (
          await vault.connect(sender).joinPool(poolId, sender.address, recipient.address, request)
        ).wait();

        // total BPT is calculated by the mock initial hook; base pool mint it after substracting the minimum BPT amount.
        const minimumBpt = await pool.getMinimumBpt();
        const totalBptOut = initialBalances.reduce((previous, current) => previous.add(current));
        expectTransferEvent(
          receipt,
          { from: ZERO_ADDRESS, to: recipient.address, value: totalBptOut.sub(minimumBpt) },
          pool
        );
      });

      it('returns the output of the inner onInitialize hook and 0 due protocol fees', async () => {
        const onInitReturn = await pool
          .connect(vaultSigner)
          .callStatic.onJoinPool(poolId, sender.address, recipient.address, initialBalances, 0, 0, request.userData);
        expect(onInitReturn).to.be.deep.eq([initialBalances, Array(tokens.length).fill(bn(0))]);
      });
    });
  });
});
