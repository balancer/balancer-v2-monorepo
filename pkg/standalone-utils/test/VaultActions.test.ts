import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { BigNumberish, bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { WeightedPoolType } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import { SwapKind } from '@balancer-labs/balancer-js';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { Contract } from 'ethers';
import { expect } from 'chai';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';

describe('VaultActions', function () {
  let vault: Vault;
  let tokens: TokenList;
  let relayer: Contract, relayerLibrary: Contract;
  let admin: SignerWithAddress, sender: SignerWithAddress;
  let poolIdA: string, poolIdB: string;

  before('get signers', async () => {
    [, admin, sender] = await ethers.getSigners();
  });

  async function setChainedReferenceContents(key: BigNumberish, value: BigNumberish): Promise<void> {
    await relayer.multicall([relayerLibrary.interface.encodeFunctionData('setChainedReferenceValue', [key, value])]);
  }

  async function expectChainedReferenceContents(key: BigNumberish, expectedValue: BigNumberish): Promise<void> {
    const receipt = await (
      await relayer.multicall([relayerLibrary.interface.encodeFunctionData('getChainedReferenceValue', [key])])
    ).wait();

    expectEvent.inIndirectReceipt(receipt, relayerLibrary.interface, 'ChainedReferenceValueRead', {
      value: bn(expectedValue),
    });
  }

  sharedBeforeEach('set up relayer', async () => {
    // Deploy Balancer Vault
    vault = await Vault.create({ admin });

    // Deploy Relayer
    relayerLibrary = await deploy('MockBatchRelayerLibrary', { args: [vault.address] });
    relayer = await deployedAt('BalancerRelayer', await relayerLibrary.getEntrypoint());

    // Authorize Relayer for all actions
    const relayerActionIds = await Promise.all(
      ['swap', 'batchSwap', 'joinPool', 'exitPool', 'setRelayerApproval', 'manageUserBalance'].map((action) =>
        actionId(vault.instance, action)
      )
    );
    const authorizer = await deployedAt('v2-vault/Authorizer', await vault.instance.getAuthorizer());
    await authorizer.connect(admin).grantRoles(relayerActionIds, relayer.address);

    // Approve relayer by sender
    await vault.instance.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
  });

  sharedBeforeEach('set up pools', async () => {
    tokens = await TokenList.create(['DAI', 'MKR', 'SNX']);
    await tokens.mint({ to: sender });
    await tokens.approve({ to: vault, from: sender });

    // Pool A: DAI-MKR
    const poolA = await WeightedPool.create({
      poolType: WeightedPoolType.WEIGHTED_POOL,
      tokens: new TokenList([tokens.DAI, tokens.MKR]).sort(),
      vault,
    });
    await poolA.init({ initialBalances: fp(100), from: sender });

    poolIdA = await poolA.getPoolId();

    // Pool B: MKR-SNX
    const poolB = await WeightedPool.create({
      poolType: WeightedPoolType.WEIGHTED_POOL,
      tokens: new TokenList([tokens.MKR, tokens.SNX]).sort(),
      vault,
    });
    await poolB.init({ initialBalances: fp(100), from: sender });

    poolIdB = await poolB.getPoolId();
  });

  describe('simple swap', () => {
    const amountIn = fp(2);

    function encodeSwap(params: {
      poolId: string;
      tokenIn: Token;
      tokenOut: Token;
      amount: BigNumberish;
      outputReference?: BigNumberish;
    }): string {
      return relayerLibrary.interface.encodeFunctionData('swap', [
        {
          poolId: params.poolId,
          kind: SwapKind.GivenIn,
          assetIn: params.tokenIn.address,
          assetOut: params.tokenOut.address,
          amount: params.amount,
          userData: '0x',
        },
        { sender: sender.address, recipient: sender.address, fromInternalBalance: false, toInternalBalance: false },
        0,
        MAX_UINT256,
        0,
        params.outputReference ?? 0,
      ]);
    }

    it('swaps with immediate amounts', async () => {
      await expectBalanceChange(
        () =>
          relayer
            .connect(sender)
            .multicall([encodeSwap({ poolId: poolIdA, tokenIn: tokens.DAI, tokenOut: tokens.MKR, amount: amountIn })]),
        tokens,
        { account: sender, changes: { DAI: amountIn.mul(-1), MKR: ['near', amountIn] } }
      );
    });

    it('stores swap output', async () => {
      const receipt = await (
        await relayer.connect(sender).multicall([
          encodeSwap({
            poolId: poolIdA,
            tokenIn: tokens.DAI,
            tokenOut: tokens.MKR,
            amount: amountIn,
            outputReference: '0xba10000000000000000000000000000000000000000000000000000000000000',
          }),
        ])
      ).wait();

      const {
        args: { amountOut },
      } = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', { poolId: poolIdA });
      await expectChainedReferenceContents(
        '0xba10000000000000000000000000000000000000000000000000000000000000',
        amountOut
      );
    });

    it('swaps with chained references', async () => {
      await setChainedReferenceContents('0xba10000000000000000000000000000000000000000000000000000000000000', amountIn);

      const receipt = await (
        await relayer.connect(sender).multicall([
          encodeSwap({
            poolId: poolIdA,
            tokenIn: tokens.DAI,
            tokenOut: tokens.MKR,
            amount: '0xba10000000000000000000000000000000000000000000000000000000000000',
          }),
        ])
      ).wait();

      const swapEvent = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', { poolId: poolIdA });
      expect(swapEvent.args.amountIn).to.equal(amountIn);
    });

    it('is chainable via multicall', async () => {
      const receipt = await (
        await expectBalanceChange(
          () =>
            relayer.connect(sender).multicall([
              encodeSwap({
                poolId: poolIdA,
                tokenIn: tokens.DAI,
                tokenOut: tokens.MKR,
                amount: amountIn,
                outputReference: '0xba10000000000000000000000000000000000000000000000000000000000000',
              }),
              encodeSwap({
                poolId: poolIdB,
                tokenIn: tokens.MKR,
                tokenOut: tokens.SNX,
                amount: '0xba10000000000000000000000000000000000000000000000000000000000000',
              }),
            ]),
          tokens,
          { account: sender, changes: { DAI: amountIn.mul(-1), SNX: ['near', amountIn] } }
        )
      ).wait();

      const {
        args: { amountOut: amountOutA },
      } = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', { poolId: poolIdA });
      const {
        args: { amountIn: amountInB },
      } = expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', { poolId: poolIdB });

      expect(amountOutA).to.equal(amountInB);
    });
  });
});
