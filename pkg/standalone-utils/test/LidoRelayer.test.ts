import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import StablePool from '@balancer-labs/v2-helpers/src/models/pools/stable/StablePool';

import { SwapKind, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { MAX_INT256, MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { BigNumberish, fp } from '@balancer-labs/v2-helpers/src/numbers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';
import { Dictionary } from 'lodash';

describe('LidoRelayer', function () {
  let WETH: Token, wstETH: Token;
  let basePoolId: string;
  let tokens: TokenList;
  let sender: SignerWithAddress, admin: SignerWithAddress;
  let vault: Vault, basePool: StablePool;
  let relayer: Contract, relayerLibrary: Contract;

  before('setup signer', async () => {
    [, admin, sender] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy Vault', async () => {
    vault = await Vault.create({ admin });

    const wethContract = await deployedAt('TestWETH', await vault.instance.WETH());
    WETH = new Token('WETH', 'WETH', 18, wethContract);

    const wstETHContract = await deploy('MockWstETH', { args: [WETH.address] });
    wstETH = new Token('wstETH', 'wstETH', 18, wstETHContract);
  });

  sharedBeforeEach('deploy pool', async () => {
    tokens = new TokenList([WETH, wstETH]).sort();

    basePool = await StablePool.create({ tokens, vault });
    basePoolId = basePool.poolId;

    // Seed liquidity in pool
    await WETH.mint(admin, fp(200));
    await WETH.approve(vault.address, MAX_UINT256, { from: admin });

    await WETH.mint(admin, fp(150));
    await WETH.approve(wstETH.address, fp(150), { from: admin });
    await wstETH.instance.connect(admin).wrap(fp(150));
    await wstETH.approve(vault.address, MAX_UINT256, { from: admin });

    await basePool.init({ initialBalances: fp(100), from: admin });
  });

  sharedBeforeEach('mint tokens to sender', async () => {
    await WETH.mint(sender, fp(100));
    await WETH.approve(vault.address, fp(100), { from: sender });

    await WETH.mint(sender, fp(2500));
    await WETH.approve(wstETH.address, fp(150), { from: sender });
    await wstETH.instance.connect(sender).wrap(fp(150));
  });

  sharedBeforeEach('set up relayer', async () => {
    // Deploy Relayer
    relayerLibrary = await deploy('BatchRelayerLibrary', { args: [vault.address, wstETH.address] });
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

  const CHAINED_REFERENCE_PREFIX = 'ba10';
  function toChainedReference(key: BigNumberish): BigNumber {
    // The full padded prefix is 66 characters long, with 64 hex characters and the 0x prefix.
    const paddedPrefix = `0x${CHAINED_REFERENCE_PREFIX}${'0'.repeat(64 - CHAINED_REFERENCE_PREFIX.length)}`;

    return BigNumber.from(paddedPrefix).add(key);
  }

  function encodeApprove(token: Token, amount: BigNumberish): string {
    return relayerLibrary.interface.encodeFunctionData('approveVault', [token.address, amount]);
  }

  function encodeWrap(sender: string, recipient: string, amount: BigNumberish, outputReference?: BigNumberish): string {
    return relayerLibrary.interface.encodeFunctionData('wrapStETH', [sender, recipient, amount, outputReference ?? 0]);
  }

  function encodeUnwrap(
    sender: string,
    recipient: string,
    amount: BigNumberish,
    outputReference?: BigNumberish
  ): string {
    return relayerLibrary.interface.encodeFunctionData('unwrapWstETH', [
      sender,
      recipient,
      amount,
      outputReference ?? 0,
    ]);
  }

  describe('swap', () => {
    function encodeSwap(params: {
      poolId: string;
      kind: SwapKind;
      tokenIn: Token;
      tokenOut: Token;
      amount: BigNumberish;
      sender: Account;
      recipient: Account;
      outputReference?: BigNumberish;
    }): string {
      return relayerLibrary.interface.encodeFunctionData('swap', [
        {
          poolId: params.poolId,
          kind: params.kind,
          assetIn: params.tokenIn.address,
          assetOut: params.tokenOut.address,
          amount: params.amount,
          userData: '0x',
        },
        {
          sender: TypesConverter.toAddress(params.sender),
          recipient: TypesConverter.toAddress(params.recipient),
          fromInternalBalance: false,
          toInternalBalance: false,
        },
        0,
        MAX_UINT256,
        0,
        params.outputReference ?? 0,
      ]);
    }

    describe('swap using stETH as an input', () => {
      it('performs the given swap', async () => {
        const poolId = basePoolId;
        const tokenIn = tokens.findBySymbol('wstETH');
        const tokenOut = tokens.WETH;
        const amount = fp(1);

        const receipt = await (
          await relayer.connect(sender).multicall([
            encodeWrap(sender.address, relayer.address, amount, toChainedReference(0)),
            encodeApprove(tokenIn, MAX_UINT256),
            encodeSwap({
              poolId,
              kind: SwapKind.GivenIn,
              tokenIn,
              tokenOut,
              amount: toChainedReference(0),
              sender: relayer,
              recipient: sender,
              outputReference: 0,
            }),
          ])
        ).wait();

        expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
          poolId,
          tokenIn: tokenIn.address,
          tokenOut: tokenOut.address,
          // amountIn: singleSwap.amount,
          // amountOut
        });
      });

      it('does not leave dust on the relayer', async () => {
        const poolId = basePoolId;
        const tokenIn = tokens.findBySymbol('wstETH');
        const tokenOut = tokens.WETH;
        const amount = fp(1);

        await relayer.connect(sender).multicall([
          encodeWrap(sender.address, relayer.address, amount, toChainedReference(0)),
          encodeApprove(tokenIn, MAX_UINT256),
          encodeSwap({
            poolId,
            kind: SwapKind.GivenIn,
            tokenIn,
            tokenOut,
            amount: toChainedReference(0),
            sender: relayer,
            recipient: sender,
            outputReference: 0,
          }),
        ]);

        expect(await WETH.balanceOf(relayer)).to.be.eq(0);
        expect(await wstETH.balanceOf(relayer)).to.be.eq(0);
      });
    });

    describe('swap using stETH as an output', () => {
      it('performs the given swap', async () => {
        const poolId = basePoolId;
        const tokenIn = tokens.WETH;
        const tokenOut = tokens.findBySymbol('wstETH');
        const amount = fp(1);

        const receipt = await (
          await relayer.connect(sender).multicall([
            encodeSwap({
              poolId,
              kind: SwapKind.GivenIn,
              tokenIn,
              tokenOut,
              amount,
              sender: sender,
              recipient: relayer,
              outputReference: toChainedReference(0),
            }),
            encodeUnwrap(relayer.address, sender.address, toChainedReference(0)),
          ])
        ).wait();

        expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
          poolId,
          tokenIn: tokenIn.address,
          tokenOut: tokenOut.address,
          // amountIn: singleSwap.amount,
          // amountOut
        });
      });

      it('does not leave dust on the relayer', async () => {
        const poolId = basePoolId;
        const tokenIn = tokens.WETH;
        const tokenOut = tokens.findBySymbol('wstETH');
        const amount = fp(1);

        await relayer.connect(sender).multicall([
          encodeSwap({
            poolId,
            kind: SwapKind.GivenIn,
            tokenIn,
            tokenOut,
            amount,
            sender,
            recipient: relayer,
            outputReference: toChainedReference(0),
          }),
          encodeUnwrap(relayer.address, sender.address, toChainedReference(0)),
        ]);

        expect(await WETH.balanceOf(relayer)).to.be.eq(0);
        expect(await wstETH.balanceOf(relayer)).to.be.eq(0);
      });
    });
  });

  describe('batchSwap', () => {
    function encodeBatchSwap(params: {
      swaps: Array<{
        poolId: string;
        tokenIn: Token;
        tokenOut: Token;
        amount: BigNumberish;
      }>;
      sender: Account;
      recipient: Account;
      outputReferences?: Dictionary<BigNumberish>;
    }): string {
      const outputReferences = new Array(tokens.length).fill(0);
      if (params.outputReferences != undefined) {
        for (const symbol in params.outputReferences) {
          outputReferences[tokens.indexOf(tokens.findBySymbol(symbol))] = params.outputReferences[symbol];
        }
      }

      return relayerLibrary.interface.encodeFunctionData('batchSwap', [
        SwapKind.GivenIn,
        params.swaps.map((swap) => ({
          poolId: swap.poolId,
          assetInIndex: tokens.indexOf(swap.tokenIn),
          assetOutIndex: tokens.indexOf(swap.tokenOut),
          amount: swap.amount,
          userData: '0x',
        })),
        tokens.addresses,
        {
          sender: TypesConverter.toAddress(params.sender),
          recipient: TypesConverter.toAddress(params.recipient),
          fromInternalBalance: false,
          toInternalBalance: false,
        },
        new Array(tokens.length).fill(MAX_INT256),
        MAX_UINT256,
        0,
        outputReferences,
      ]);
    }

    describe('swap using stETH as an input', () => {
      it('performs the given swap', async () => {
        const poolId = basePoolId;
        const tokenIn = tokens.findBySymbol('wstETH');
        const tokenOut = tokens.WETH;
        const amount = fp(1);

        const receipt = await (
          await relayer.connect(sender).multicall([
            encodeWrap(sender.address, relayer.address, amount, toChainedReference(0)),
            encodeApprove(tokenIn, MAX_UINT256),
            encodeBatchSwap({
              swaps: [{ poolId, tokenIn, tokenOut, amount: toChainedReference(0) }],
              sender: relayer,
              recipient: sender,
            }),
          ])
        ).wait();

        expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
          poolId: poolId,
          tokenIn: tokenIn.address,
          tokenOut: tokenOut.address,
          // amountIn,
          // amountOut
        });
      });

      it('does not leave dust on the relayer', async () => {
        const poolId = basePoolId;
        const tokenIn = tokens.findBySymbol('wstETH');
        const tokenOut = tokens.WETH;
        const amount = fp(1);

        await relayer.connect(sender).multicall([
          encodeWrap(sender.address, relayer.address, amount, toChainedReference(0)),
          encodeApprove(tokenIn, MAX_UINT256),
          encodeBatchSwap({
            swaps: [{ poolId, tokenIn, tokenOut, amount: toChainedReference(0) }],
            sender: relayer,
            recipient: sender,
          }),
        ]);

        expect(await WETH.balanceOf(relayer)).to.be.eq(0);
        expect(await wstETH.balanceOf(relayer)).to.be.eq(0);
      });
    });

    describe('swap using stETH as an output', () => {
      it('performs the given swap', async () => {
        const poolId = basePoolId;
        const tokenIn = tokens.WETH;
        const tokenOut = tokens.findBySymbol('wstETH');
        const amount = fp(1);

        const receipt = await (
          await relayer.connect(sender).multicall([
            encodeBatchSwap({
              swaps: [{ poolId, tokenIn, tokenOut, amount }],
              sender: sender,
              recipient: relayer,
              outputReferences: { wstETH: toChainedReference(0) },
            }),
            encodeUnwrap(relayer.address, sender.address, toChainedReference(0)),
          ])
        ).wait();

        expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
          poolId: poolId,
          tokenIn: tokenIn.address,
          tokenOut: tokenOut.address,
          // amountIn,
          // amountOut
        });
      });

      it('does not leave dust on the relayer', async () => {
        const poolId = basePoolId;
        const tokenIn = tokens.WETH;
        const tokenOut = tokens.findBySymbol('wstETH');
        const amount = fp(1);

        await relayer.connect(sender).multicall([
          encodeBatchSwap({
            swaps: [{ poolId, tokenIn, tokenOut, amount }],
            sender: sender,
            recipient: relayer,
            outputReferences: { wstETH: toChainedReference(0) },
          }),
          encodeUnwrap(relayer.address, sender.address, toChainedReference(0)),
        ]);

        expect(await WETH.balanceOf(relayer)).to.be.eq(0);
        expect(await wstETH.balanceOf(relayer)).to.be.eq(0);
      });
    });
  });

  describe('joinPool', () => {
    function encodeJoin(params: {
      poolId: string;
      sender: Account;
      recipient: Account;
      assets: TokenList;
      maxAmountsIn: BigNumberish[];
      userData: string;
      outputReference?: BigNumberish;
    }): string {
      return relayerLibrary.interface.encodeFunctionData('joinPool', [
        params.poolId,
        0, // WeightedPool
        TypesConverter.toAddress(params.sender),
        TypesConverter.toAddress(params.recipient),
        {
          assets: params.assets.addresses,
          maxAmountsIn: params.maxAmountsIn,
          userData: params.userData,
          fromInternalBalance: false,
        },
        0,
        params.outputReference ?? 0,
      ]);
    }

    context('when the relayer is authorized', () => {
      it('joins the pool', async () => {
        const amount = fp(1);

        const receipt = await relayer.connect(sender).multicall([
          encodeWrap(sender.address, relayer.address, amount, toChainedReference(0)),
          encodeApprove(wstETH, MAX_UINT256),
          encodeJoin({
            poolId: basePoolId,
            assets: tokens,
            sender: relayer,
            recipient: sender,
            maxAmountsIn: tokens.map(() => MAX_UINT256),
            userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(
              tokens.map((token) => (token === wstETH ? toChainedReference(0) : 0)),
              0
            ),
          }),
        ]);

        expectEvent.inIndirectReceipt(await receipt.wait(), vault.instance.interface, 'PoolBalanceChanged', {
          poolId: basePoolId,
          liquidityProvider: relayer.address,
        });
      });

      it('does not take wstETH from the sender', async () => {
        const amount = fp(1);

        const wstETHBalanceBefore = await wstETH.balanceOf(sender);

        await relayer.connect(sender).multicall([
          encodeWrap(sender.address, relayer.address, amount, toChainedReference(0)),
          encodeApprove(wstETH, MAX_UINT256),
          encodeJoin({
            poolId: basePoolId,
            sender: relayer,
            recipient: sender,
            assets: tokens,
            maxAmountsIn: tokens.map(() => MAX_UINT256),
            userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(
              tokens.map((token) => (token === wstETH ? toChainedReference(0) : 0)),
              0
            ),
          }),
        ]);

        const wstETHBalanceAfter = await wstETH.balanceOf(sender);
        expect(wstETHBalanceAfter).to.be.eq(wstETHBalanceBefore);
      });

      it('does not leave dust on the relayer', async () => {
        const amount = fp(1);

        await relayer.connect(sender).multicall([
          encodeWrap(sender.address, relayer.address, amount, toChainedReference(0)),
          encodeApprove(wstETH, MAX_UINT256),
          encodeJoin({
            poolId: basePoolId,
            sender: relayer,
            recipient: sender,
            assets: tokens,
            maxAmountsIn: tokens.map(() => MAX_UINT256),
            userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(
              tokens.map((token) => (token === wstETH ? toChainedReference(0) : 0)),
              0
            ),
          }),
        ]);

        expect(await WETH.balanceOf(relayer)).to.be.eq(0);
        expect(await wstETH.balanceOf(relayer)).to.be.eq(0);
      });
    });
  });

  // describe('exitPool', () => {
  //   function encodeExit(params: {
  //     poolId: string;
  //     assets: TokenList;
  //     minAmountsOut: BigNumberish[];
  //     userData: string;
  //     outputReferences?: Dictionary<BigNumberish>;
  //   }): string {
  //     const outputReferences = new Array(params.assets.length).fill(0);
  //     if (params.outputReferences != undefined) {
  //       for (const symbol in params.outputReferences) {
  //         outputReferences[params.assets.indexOf(params.assets.findBySymbol(symbol))] = params.outputReferences[symbol];
  //       }
  //     }

  //     return relayerLibrary.interface.encodeFunctionData('exitPool', [
  //       params.poolId,
  //       0, // WeightedPool
  //       sender.address,
  //       sender.address,
  //       {
  //         assets: params.assets.addresses,
  //         minAmountsOut: params.minAmountsOut,
  //         userData: params.userData,
  //         toInternalBalance: false,
  //       },
  //       0,
  //       outputReferences,
  //     ]);
  //   }

  //   it('exits the pool', async () => {
  //     const amount = fp(1);

  //     const receipt = await (
  //       await relayer.connect(sender).multicall([
  //         encodeExit({
  //           poolId: basePoolId,
  //           assets: tokens,
  //           minAmountsOut: [0, 0],
  //           userData: WeightedPoolEncoder.exitExactBPTInForTokensOut(amount),
  //           outputReferences: {
  //             wstETH: toChainedReference(0),
  //           },
  //         }),
  //         encodeUnwrap(sender.address, sender.address, toChainedReference(0)),
  //       ])
  //     ).wait();

  //     expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'PoolBalanceChanged', {
  //       poolId: basePoolId,
  //       liquidityProvider: sender.address,
  //     });
  //   });

  //   it('does not send wstETH to the recipient', async () => {
  //     const amount = fp(1);
  //     const wstETHBalanceBefore = await wstETH.balanceOf(sender);

  //     await relayer.connect(sender).multicall([
  //       encodeExit({
  //         poolId: basePoolId,
  //         assets: tokens,
  //         minAmountsOut: [0, 0],
  //         userData: WeightedPoolEncoder.exitExactBPTInForTokensOut(amount),
  //         outputReferences: {
  //           wstETH: toChainedReference(0),
  //         },
  //       }),
  //       encodeUnwrap(sender.address, sender.address, toChainedReference(0)),
  //     ]);

  //     const wstETHBalanceAfter = await wstETH.balanceOf(sender);
  //     expect(wstETHBalanceAfter).to.be.eq(wstETHBalanceBefore);
  //   });

  //   it('does not leave dust on the relayer', async () => {
  //     const amount = fp(1);

  //     await relayer.connect(sender).multicall([
  //       encodeExit({
  //         poolId: basePoolId,
  //         assets: tokens,
  //         minAmountsOut: [0, 0],
  //         userData: WeightedPoolEncoder.exitExactBPTInForTokensOut(amount),
  //         outputReferences: {
  //           wstETH: toChainedReference(0),
  //         },
  //       }),
  //       encodeUnwrap(sender.address, sender.address, toChainedReference(0)),
  //     ]);

  //     expect(await WETH.balanceOf(relayer)).to.be.eq(0);
  //     expect(await wstETH.balanceOf(relayer)).to.be.eq(0);
  //   });
  // });
});
