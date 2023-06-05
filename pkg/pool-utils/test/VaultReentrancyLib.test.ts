import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { MONTH } from '@balancer-labs/v2-helpers/src/time';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import {
  JoinPoolRequest,
  ExitPoolRequest,
  PoolSpecialization,
  WeightedPoolEncoder,
  SwapKind,
} from '@balancer-labs/balancer-js';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { ANY_ADDRESS, MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';
import { random } from 'lodash';
import { defaultAbiCoder } from 'ethers/lib/utils';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('VaultReentrancyLib', function () {
  let admin: SignerWithAddress, poolOwner: SignerWithAddress;
  let tokens: TokenList;

  const MIN_SWAP_FEE_PERCENTAGE = fp(0.000001);

  const PAUSE_WINDOW_DURATION = MONTH * 3;
  const BUFFER_PERIOD_DURATION = MONTH;

  before(async () => {
    [, admin, poolOwner] = await ethers.getSigners();
  });

  function deployPool(
    params: {
      tokens?: TokenList | string[];
      owner?: Account;
      from?: SignerWithAddress;
      vault?: string;
    } = {}
  ): Promise<Contract> {
    const { vault } = params;
    let { owner } = params;

    if (!owner) owner = ZERO_ADDRESS;

    return deploy('MockReentrancyPool', {
      from: params.from,
      args: [
        vault,
        PoolSpecialization.GeneralPool,
        'Balancer Pool Token',
        'BPT',
        tokens.addresses,
        Array(tokens.length).fill(ZERO_ADDRESS),
        MIN_SWAP_FEE_PERCENTAGE,
        PAUSE_WINDOW_DURATION,
        BUFFER_PERIOD_DURATION,
        TypesConverter.toAddress(owner),
      ],
    });
  }

  describe('VaultReentrancyLib - standard non-view pool hooks', () => {
    let authorizer: Contract, vault: Contract, pool: Contract;
    let poolId: string;

    sharedBeforeEach('deploy vault', async () => {
      ({ instance: vault, authorizer } = await Vault.create({ admin }));
      tokens = await TokenList.create(['DAI', 'MKR', 'SNX'], { sorted: true });
    });

    sharedBeforeEach('deploy pool', async () => {
      pool = await deployPool({ vault: vault.address, tokens, owner: poolOwner });
    });

    context('in Vault context', () => {
      sharedBeforeEach('initialize pool', async () => {
        const initialBalances = Array(tokens.length).fill(fp(1000));
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

      it('reverts when called from join', async () => {
        const OTHER_JOIN_KIND = 1;

        const request: JoinPoolRequest = {
          assets: tokens.addresses,
          maxAmountsIn: Array(tokens.length).fill(0),
          userData: defaultAbiCoder.encode(['uint256'], [OTHER_JOIN_KIND]),
          fromInternalBalance: false,
        };

        await expect(
          vault.connect(poolOwner).joinPool(poolId, poolOwner.address, poolOwner.address, request)
        ).to.be.revertedWith('REENTRANCY');
      });

      it('reverts when called from exit', async () => {
        const OTHER_EXIT_KIND = 1;

        const request: ExitPoolRequest = {
          assets: tokens.addresses,
          minAmountsOut: Array(tokens.length).fill(0),
          userData: defaultAbiCoder.encode(['uint256'], [OTHER_EXIT_KIND]),
          toInternalBalance: false,
        };

        await expect(
          vault.connect(poolOwner).exitPool(poolId, poolOwner.address, poolOwner.address, request)
        ).to.be.revertedWith('REENTRANCY');
      });

      it('reverts when called from swap', async () => {
        await expect(
          vault.connect(poolOwner).swap(
            {
              kind: SwapKind.GivenIn,
              poolId,
              assetIn: tokens.DAI.address,
              assetOut: tokens.MKR.address,
              amount: fp(1),
              userData: '0x',
            },
            {
              sender: poolOwner.address,
              recipient: poolOwner.address,
              fromInternalBalance: false,
              toInternalBalance: false,
            },
            0,
            MAX_UINT256
          )
        ).to.be.revertedWith('REENTRANCY');
      });

      describe('recovery mode', () => {
        sharedBeforeEach('enable recovery mode', async () => {
          const enableRecoveryAction = await actionId(pool, 'enableRecoveryMode');
          await authorizer.connect(admin).grantPermission(enableRecoveryAction, poolOwner.address, ANY_ADDRESS);

          await pool.connect(poolOwner).enableRecoveryMode();

          const recoveryMode = await pool.inRecoveryMode();
          expect(recoveryMode).to.be.true;
        });

        it('reverts when called from Recovery Mode exit', async () => {
          const RECOVERY_MODE_EXIT_KIND = 255;

          const preExitBPT = await pool.balanceOf(poolOwner.address);
          const exitBPT = preExitBPT.div(3);

          const request: ExitPoolRequest = {
            assets: tokens.addresses,
            minAmountsOut: Array(tokens.length).fill(0),
            userData: defaultAbiCoder.encode(['uint256', 'uint256'], [RECOVERY_MODE_EXIT_KIND, exitBPT]),
            toInternalBalance: false,
          };

          await expect(
            vault.connect(poolOwner).exitPool(poolId, poolOwner.address, poolOwner.address, request)
          ).to.be.revertedWith('REENTRANCY');
        });
      });
    });

    context('external function call', () => {
      it('can call a protected function outside the Vault context', async () => {
        const receipt = await (await pool.protectedFunction()).wait();

        expectEvent.inReceipt(receipt, 'ProtectedFunctionCalled');
      });

      it('can call a protected view function outside the Vault context', async () => {
        await expect(pool.protectedViewFunction()).to.not.be.reverted;
      });

      it('do not waste gas', async () => {
        await expect(pool.protectedFunction({ gasLimit: 40000 })).to.not.be.reverted;
      });
    });
  });

  describe('VaultReentrancyLib - read-only hooks', () => {
    let vault: Contract, pool: Contract;

    sharedBeforeEach('deploy mock vault', async () => {
      ({ instance: vault } = await Vault.create({ admin, mocked: true }));
      pool = await deployPool({ vault: vault.address, tokens, owner: poolOwner });
    });

    it('reverts when calling a protected view function', async () => {
      await expect(vault.connect(poolOwner).functionWithHook(pool.address)).to.be.revertedWith('REENTRANCY');
    });
  });
});
