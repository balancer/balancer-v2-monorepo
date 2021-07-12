import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import StablePool from '@balancer-labs/v2-helpers/src/models/pools/stable/StablePool';

import {
  BatchSwapStep,
  ExitPoolRequest,
  FundManagement,
  JoinPoolRequest,
  SingleSwap,
  SwapKind,
  WeightedPoolEncoder,
} from '@balancer-labs/balancer-js';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { MAX_INT256, MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { BigNumberish, fp } from '@balancer-labs/v2-helpers/src/numbers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';

describe('LidoBatchRelayer', function () {
  let WETH: Token, wstETH: Token;
  let basePoolId: string;
  let sender: SignerWithAddress, recipient: SignerWithAddress, admin: SignerWithAddress;
  let vault: Vault, basePool: StablePool;
  let relayer: Contract;

  before('setup signer', async () => {
    [, admin, sender, recipient] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy Vault', async () => {
    vault = await Vault.create({ admin });

    const wethContract = await deployedAt('TestWETH', await vault.instance.WETH());
    WETH = new Token('WETH', 'WETH', 18, wethContract);

    const wstETHContract = await deploy('TestWstETH', { args: [WETH.address] });
    wstETH = new Token('wstETH', 'wstETH', 18, wstETHContract);

    relayer = await deploy('LidoBatchRelayer', { args: [vault.address, ZERO_ADDRESS, wstETH.address] });
  });

  describe('Simple', () => {
    let basePoolTokens: TokenList;

    sharedBeforeEach('deploy pool', async () => {
      basePoolTokens = new TokenList([WETH, wstETH]).sort();

      basePool = await StablePool.create({ tokens: basePoolTokens, vault });
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
      await wstETH.instance.connect(sender).approve(vault.address, fp(100));
    });

    describe('lidoSwap', () => {
      let funds: FundManagement;
      const limit = 0;
      const deadline = MAX_UINT256;

      sharedBeforeEach('build fund management', async () => {
        funds = {
          sender: sender.address,
          fromInternalBalance: false,
          recipient: sender.address,
          toInternalBalance: false,
        };
      });

      context('when the relayer is authorized', () => {
        sharedBeforeEach('allow relayer', async () => {
          const manageUserBalanceAction = await actionId(vault.instance, 'manageUserBalance');
          const swapAction = await actionId(vault.instance, 'swap');

          await vault.authorizer?.connect(admin).grantRoles([manageUserBalanceAction, swapAction], relayer.address);
        });

        context('when the user did allow the relayer', () => {
          sharedBeforeEach('allow relayer', async () => {
            await vault.instance.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
          });

          describe('swap using stETH as an input', () => {
            let singleSwap: SingleSwap;

            sharedBeforeEach('build swap request', async () => {
              singleSwap = {
                kind: SwapKind.GivenIn,
                poolId: basePoolId,
                assetIn: basePoolTokens.findBySymbol('wstETH').address,
                assetOut: basePoolTokens.WETH.address,
                amount: fp(1),
                userData: '0x',
              };
            });

            it('performs the given swap', async () => {
              const receipt = await relayer.connect(sender).lidoSwap(singleSwap, funds, limit, deadline);

              expectEvent.inIndirectReceipt(await receipt.wait(), vault.instance.interface, 'Swap', {
                poolId: singleSwap.poolId,
                tokenIn: singleSwap.assetIn,
                tokenOut: singleSwap.assetOut,
                amountIn: singleSwap.amount,
                // amountOut
              });
            });

            it('does not leave dust on the relayer', async () => {
              await relayer.connect(sender).lidoSwap(singleSwap, funds, limit, deadline);

              expect(await WETH.balanceOf(relayer)).to.be.eq(0);
              expect(await wstETH.balanceOf(relayer)).to.be.eq(0);
            });
          });

          describe('swap using stETH as an output', () => {
            let singleSwap: SingleSwap;

            sharedBeforeEach('build swap request', async () => {
              singleSwap = {
                kind: SwapKind.GivenIn,
                poolId: basePoolId,
                assetIn: basePoolTokens.WETH.address,
                assetOut: basePoolTokens.findBySymbol('wstETH').address,
                amount: fp(1),
                userData: '0x',
              };
            });

            it('performs the given swap', async () => {
              const receipt = await relayer.connect(sender).lidoSwap(singleSwap, funds, limit, deadline);

              expectEvent.inIndirectReceipt(await receipt.wait(), vault.instance.interface, 'Swap', {
                poolId: singleSwap.poolId,
                tokenIn: singleSwap.assetIn,
                tokenOut: singleSwap.assetOut,
                amountIn: singleSwap.amount,
                // amountOut
              });
            });

            it('does not leave dust on the relayer', async () => {
              await relayer.connect(sender).lidoSwap(singleSwap, funds, limit, deadline);

              expect(await WETH.balanceOf(relayer)).to.be.eq(0);
              expect(await wstETH.balanceOf(relayer)).to.be.eq(0);
            });
          });
        });

        context('when the user did not allow the relayer', () => {
          let singleSwap: SingleSwap;

          sharedBeforeEach('build swap request', async () => {
            singleSwap = {
              kind: SwapKind.GivenIn,
              poolId: basePoolId,
              assetIn: basePoolTokens.WETH.address,
              assetOut: basePoolTokens.findBySymbol('wstETH').address,
              amount: fp(1),
              userData: '0x',
            };
          });

          it('reverts', async () => {
            await expect(relayer.connect(sender).lidoSwap(singleSwap, funds, limit, deadline)).to.be.revertedWith(
              'USER_DOESNT_ALLOW_RELAYER'
            );
          });
        });
      });
    });

    describe('lidoBatchSwap', () => {
      let swaps: BatchSwapStep[];
      let limits: BigNumberish[];
      let assets: string[];
      let funds: FundManagement;
      const deadline = MAX_UINT256;

      sharedBeforeEach('build fund management', async () => {
        funds = {
          sender: sender.address,
          fromInternalBalance: false,
          recipient: sender.address,
          toInternalBalance: false,
        };
      });

      context('when the relayer is authorized', () => {
        sharedBeforeEach('allow relayer', async () => {
          const manageUserBalanceAction = await actionId(vault.instance, 'manageUserBalance');
          const batchSwapAction = await actionId(vault.instance, 'batchSwap');

          await vault.authorizer
            ?.connect(admin)
            .grantRoles([manageUserBalanceAction, batchSwapAction], relayer.address);
        });

        context('when the user did allow the relayer', () => {
          sharedBeforeEach('allow relayer', async () => {
            await vault.instance.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
          });

          describe('swap using stETH as an input', () => {
            sharedBeforeEach('build swap request', async () => {
              swaps = [
                {
                  poolId: basePoolId,
                  assetInIndex: basePoolTokens.findIndexBySymbol('wstETH'),
                  assetOutIndex: basePoolTokens.findIndexBySymbol('WETH'),
                  amount: fp(1),
                  userData: '0x',
                },
              ];

              assets = basePoolTokens.addresses;
              limits = basePoolTokens.map((token) => (token.symbol === 'wstETH' ? fp(1) : 0));
            });

            it('performs the given swap', async () => {
              const receipt = await relayer
                .connect(sender)
                .lidoBatchSwap(SwapKind.GivenIn, swaps, assets, funds, limits, deadline);

              expectEvent.inIndirectReceipt(await receipt.wait(), vault.instance.interface, 'Swap', {
                poolId: swaps[0].poolId,
                tokenIn: assets[swaps[0].assetInIndex],
                tokenOut: assets[swaps[0].assetOutIndex],
                amountIn: swaps[0].amount,
                // amountOut
              });
            });

            it('does not leave dust on the relayer', async () => {
              await relayer.connect(sender).lidoBatchSwap(SwapKind.GivenIn, swaps, assets, funds, limits, deadline);

              expect(await WETH.balanceOf(relayer)).to.be.eq(0);
              expect(await wstETH.balanceOf(relayer)).to.be.eq(0);
            });
          });

          describe('swap using stETH as an output', () => {
            sharedBeforeEach('build swap request', async () => {
              swaps = [
                {
                  poolId: basePoolId,
                  assetInIndex: basePoolTokens.findIndexBySymbol('WETH'),
                  assetOutIndex: basePoolTokens.findIndexBySymbol('wstETH'),
                  amount: fp(1),
                  userData: '0x',
                },
              ];

              assets = basePoolTokens.addresses;
              limits = basePoolTokens.map((token) => (token.symbol === 'wstETH' ? 0 : fp(1)));
            });

            it('performs the given swap', async () => {
              const receipt = await relayer
                .connect(sender)
                .lidoBatchSwap(SwapKind.GivenIn, swaps, assets, funds, limits, deadline);

              expectEvent.inIndirectReceipt(await receipt.wait(), vault.instance.interface, 'Swap', {
                poolId: swaps[0].poolId,
                tokenIn: assets[swaps[0].assetInIndex],
                tokenOut: assets[swaps[0].assetOutIndex],
                amountIn: swaps[0].amount,
                // amountOut
              });
            });

            it('does not leave dust on the relayer', async () => {
              await relayer.connect(sender).lidoBatchSwap(SwapKind.GivenIn, swaps, assets, funds, limits, deadline);

              expect(await WETH.balanceOf(relayer)).to.be.eq(0);
              expect(await wstETH.balanceOf(relayer)).to.be.eq(0);
            });
          });
        });

        context('when the user did not allow the relayer', () => {
          sharedBeforeEach('build swap request', async () => {
            swaps = [
              {
                poolId: basePoolId,
                assetInIndex: basePoolTokens.findIndexBySymbol('WETH'),
                assetOutIndex: basePoolTokens.findIndexBySymbol('wstETH'),
                amount: fp(1),
                userData: '0x',
              },
            ];

            assets = basePoolTokens.addresses;
            limits = [fp(1), 0];
          });

          it('reverts', async () => {
            await expect(
              relayer.connect(sender).lidoBatchSwap(SwapKind.GivenIn, swaps, assets, funds, limits, deadline)
            ).to.be.revertedWith('USER_DOESNT_ALLOW_RELAYER');
          });
        });
      });
    });

    describe('lidoJoinPool', () => {
      let joinRequest: JoinPoolRequest;

      sharedBeforeEach('build join request', async () => {
        joinRequest = {
          assets: basePoolTokens.addresses,
          maxAmountsIn: [0, fp(1)],
          userData: WeightedPoolEncoder.joinExactTokensInForBPTOut([0, fp(1)], 0),
          fromInternalBalance: false,
        };
      });

      context('when the relayer is authorized', () => {
        sharedBeforeEach('allow relayer', async () => {
          const manageUserBalanceAction = await actionId(vault.instance, 'manageUserBalance');
          const joinAction = await actionId(vault.instance, 'joinPool');

          await vault.authorizer?.connect(admin).grantRoles([manageUserBalanceAction, joinAction], relayer.address);
        });

        context('when the user did allow the relayer', () => {
          sharedBeforeEach('allow relayer', async () => {
            await vault.instance.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
          });

          it('joins the pool', async () => {
            const receipt = await relayer
              .connect(sender)
              .lidoJoinPool(basePoolId, sender.address, sender.address, joinRequest);

            expectEvent.inIndirectReceipt(await receipt.wait(), vault.instance.interface, 'PoolBalanceChanged', {
              poolId: basePoolId,
              liquidityProvider: sender.address,
            });
          });

          it('does not take wstETH from the sender', async () => {
            const wstETHBalanceBefore = await wstETH.balanceOf(sender);
            await relayer.connect(sender).lidoJoinPool(basePoolId, sender.address, sender.address, joinRequest);

            const wstETHBalanceAfter = await wstETH.balanceOf(sender);
            expect(wstETHBalanceAfter).to.be.eq(wstETHBalanceBefore);
          });

          it('does not leave dust on the relayer', async () => {
            await relayer.connect(sender).lidoJoinPool(basePoolId, sender.address, sender.address, joinRequest);

            expect(await WETH.balanceOf(relayer)).to.be.eq(0);
            expect(await wstETH.balanceOf(relayer)).to.be.eq(0);
          });
        });

        context('when the user did not allow the relayer', () => {
          it('reverts', async () => {
            await expect(
              relayer.connect(sender).lidoJoinPool(basePoolId, sender.address, sender.address, joinRequest)
            ).to.be.revertedWith('USER_DOESNT_ALLOW_RELAYER');
          });
        });
      });
    });

    describe('lidoExitPool', () => {
      let exitRequest: ExitPoolRequest;

      sharedBeforeEach('build exit request', async () => {
        exitRequest = {
          assets: basePoolTokens.addresses,
          minAmountsOut: [0, 0],
          userData: WeightedPoolEncoder.exitExactBPTInForOneTokenOut(fp(1), 1),
          toInternalBalance: false,
        };

        // Send user some BPT
        await basePool.instance.connect(admin).transfer(sender.address, fp(1));
      });

      context('when the relayer is authorized', () => {
        sharedBeforeEach('allow relayer', async () => {
          const manageUserBalanceAction = await actionId(vault.instance, 'manageUserBalance');
          const exitAction = await actionId(vault.instance, 'exitPool');

          await vault.authorizer?.connect(admin).grantRoles([manageUserBalanceAction, exitAction], relayer.address);
        });

        context('when the user did allow the relayer', () => {
          sharedBeforeEach('allow relayer', async () => {
            await vault.instance.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
          });

          it('exits the pool', async () => {
            const receipt = await relayer
              .connect(sender)
              .lidoExitPool(basePoolId, sender.address, sender.address, exitRequest);

            expectEvent.inIndirectReceipt(await receipt.wait(), vault.instance.interface, 'PoolBalanceChanged', {
              poolId: basePoolId,
              liquidityProvider: sender.address,
            });
          });

          it('does not send wstETH to the recipient', async () => {
            const wstETHBalanceBefore = await wstETH.balanceOf(sender);
            await relayer.connect(sender).lidoExitPool(basePoolId, sender.address, sender.address, exitRequest);

            const wstETHBalanceAfter = await wstETH.balanceOf(sender);
            expect(wstETHBalanceAfter).to.be.eq(wstETHBalanceBefore);
          });

          it('does not leave dust on the relayer', async () => {
            await relayer.connect(sender).lidoExitPool(basePoolId, sender.address, sender.address, exitRequest);

            expect(await WETH.balanceOf(relayer)).to.be.eq(0);
            expect(await wstETH.balanceOf(relayer)).to.be.eq(0);
          });
        });

        context('when the user did not allow the relayer', () => {
          it('reverts', async () => {
            await expect(
              relayer.connect(sender).lidoExitPool(basePoolId, sender.address, sender.address, exitRequest)
            ).to.be.revertedWith('USER_DOESNT_ALLOW_RELAYER');
          });
        });
      });
    });
  });

  describe('Advanced', () => {
    let basePoolTokens: TokenList, metaPoolTokens: TokenList;
    let DAI: Token;
    let basePoolId: string, metaPoolId: string;
    let basePool: StablePool, metaPool: StablePool;
    // An array of token amounts which will be added/removed to pool's balance on joins/exits
    const tokenIncrements = Array(2).fill(fp(1));

    sharedBeforeEach('deploy sample pool', async () => {
      DAI = await Token.create('DAI');

      basePoolTokens = new TokenList([DAI, WETH]).sort();
      basePool = await StablePool.create({ tokens: basePoolTokens, vault });
      basePoolId = basePool.poolId;

      // Approve vault to take LP's BPT
      const bptToken = new Token('BPT', 'BPT', 18, basePool.instance);
      await bptToken.approve(vault.address, fp(100), { from: sender });

      metaPoolTokens = new TokenList([wstETH, bptToken]).sort();
      metaPool = await StablePool.create({ tokens: metaPoolTokens, vault });
      metaPoolId = metaPool.poolId;

      // Seed liquidity in pools

      // Init basePool
      await basePoolTokens.mint({ to: admin, amount: fp(2000) });
      await basePoolTokens.approve({ to: vault.address, amount: MAX_UINT256, from: admin });
      await bptToken.approve(vault.address, MAX_UINT256, { from: admin });

      await basePool.init({ initialBalances: fp(100), from: admin });

      // Init metaPool
      await WETH.mint(admin, fp(150));
      await WETH.approve(wstETH.address, fp(150), { from: admin });
      await wstETH.instance.connect(admin).wrap(fp(150));
      await wstETH.instance.connect(admin).approve(vault.address, fp(100));

      await metaPool.init({ initialBalances: fp(100), from: admin });
    });

    sharedBeforeEach('mint tokens to sender', async () => {
      const tokens = new TokenList([DAI, WETH]);
      await tokens.mint({ to: sender, amount: fp(100) });
      await tokens.approve({ to: vault.address, amount: fp(100), from: sender });

      await WETH.mint(sender, fp(150));
      await WETH.approve(wstETH.address, fp(150), { from: sender });
      await wstETH.instance.connect(sender).wrap(fp(150));
      await wstETH.instance.connect(sender).approve(vault.address, fp(100));
    });

    describe('lidoJoinAndSwap', () => {
      let joinRequest: {
        assets: string[];
        maxAmountsIn: BigNumberish[];
        userData: string;
        fromInternalBalance: boolean;
      };
      let swaps: {
        poolId: string;
        assetInIndex: number;
        assetOutIndex: number;
        amount: BigNumberish;
        userData: string;
      }[];
      let assets: string[];
      let limits: BigNumberish[];
      const deadline = MAX_UINT256;

      sharedBeforeEach('build join request', async () => {
        joinRequest = {
          assets: basePoolTokens.addresses,
          maxAmountsIn: tokenIncrements,
          userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(tokenIncrements, 0),
          fromInternalBalance: false,
        };

        swaps = [
          {
            poolId: metaPoolId,
            assetInIndex: metaPoolTokens.findIndexBySymbol('BPT'),
            assetOutIndex: metaPoolTokens.findIndexBySymbol('wstETH'),
            amount: 0,
            userData: '0x',
          },
        ];

        assets = metaPoolTokens.addresses;

        limits = assets.map(() => MAX_INT256);
      });
      context('when the relayer is allowed to join', () => {
        sharedBeforeEach('allow relayer', async () => {
          const joinAction = await actionId(vault.instance, 'joinPool');
          const batchSwapAction = await actionId(vault.instance, 'batchSwap');
          const manageUserBalanceAction = await actionId(vault.instance, 'manageUserBalance');

          await vault.authorizer
            ?.connect(admin)
            .grantRoles([joinAction, batchSwapAction, manageUserBalanceAction], relayer.address);
        });

        context('when the user did allow the relayer', () => {
          sharedBeforeEach('allow relayer', async () => {
            await vault.instance.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
          });

          it('joins the pool', async () => {
            const receipt = await relayer
              .connect(sender)
              .lidoJoinAndSwap(basePoolId, recipient.address, joinRequest, swaps, assets, limits, deadline);

            expectEvent.inIndirectReceipt(await receipt.wait(), vault.instance.interface, 'PoolBalanceChanged', {
              poolId: basePoolId,
              liquidityProvider: sender.address,
            });
          });

          it("reverts if swap doesn't use BPT", async () => {
            const badAssets = basePoolTokens.addresses;
            await expect(
              relayer
                .connect(sender)
                .lidoJoinAndSwap(basePoolId, recipient.address, joinRequest, swaps, badAssets, limits, deadline)
            ).to.be.revertedWith('Must use BPT as input to swap');
          });

          it('approves the vault', async () => {
            const receipt = await relayer
              .connect(sender)
              .lidoJoinAndSwap(basePoolId, recipient.address, joinRequest, swaps, assets, limits, deadline);

            expectEvent.inIndirectReceipt(await receipt.wait(), basePool.instance.interface, 'Approval', {
              owner: relayer.address,
              spender: vault.address,
              value: MAX_UINT256,
            });
          });

          it('performs the given swap', async () => {
            const receipt = await relayer
              .connect(sender)
              .lidoJoinAndSwap(basePoolId, recipient.address, joinRequest, swaps, assets, limits, deadline);

            expectEvent.inIndirectReceipt(await receipt.wait(), vault.instance.interface, 'Swap', {
              poolId: metaPoolId,
              tokenIn: assets[swaps[0].assetInIndex],
              tokenOut: assets[swaps[0].assetOutIndex],
              // amountIn,
              // amountOut
            });
          });
        });

        context('when the user did not allow the relayer', () => {
          sharedBeforeEach('disallow relayer', async () => {
            await vault.instance.connect(sender).setRelayerApproval(sender.address, relayer.address, false);
          });

          it('reverts', async () => {
            await expect(
              relayer
                .connect(sender)
                .lidoJoinAndSwap(basePoolId, recipient.address, joinRequest, swaps, assets, limits, deadline)
            ).to.be.revertedWith('USER_DOESNT_ALLOW_RELAYER');
          });
        });
      });
    });

    describe('lidoSwapAndExit', () => {
      let exitRequest: {
        assets: string[];
        minAmountsOut: BigNumberish[];
        userData: string;
        toInternalBalance: boolean;
      };
      let swaps: {
        poolId: string;
        assetInIndex: number;
        assetOutIndex: number;
        amount: BigNumberish;
        userData: string;
      }[];
      let assets: string[];
      let limits: BigNumberish[];
      const swapKind = SwapKind.GivenIn;
      const deadline = MAX_UINT256;

      sharedBeforeEach('build exit request', async () => {
        exitRequest = {
          assets: basePoolTokens.addresses,
          minAmountsOut: basePoolTokens.map(() => 0),
          // bptAmountIn is overwritten by the relayer
          userData: WeightedPoolEncoder.exitExactBPTInForOneTokenOut(0, basePoolTokens.findIndexBySymbol('WETH')),
          toInternalBalance: false,
        };

        swaps = [
          {
            poolId: metaPoolId,
            assetInIndex: metaPoolTokens.findIndexBySymbol('wstETH'),
            assetOutIndex: metaPoolTokens.findIndexBySymbol('BPT'),
            amount: fp(1),
            userData: '0x',
          },
        ];

        assets = metaPoolTokens.addresses;
        limits = metaPoolTokens.map((token) => (token.symbol === 'wstETH' ? fp(1) : 0));
      });

      context('when the relayer is allowed to swap/exit', () => {
        sharedBeforeEach('allow relayer', async () => {
          const exitAction = await actionId(vault.instance, 'exitPool');
          const batchSwapAction = await actionId(vault.instance, 'batchSwap');
          const manageUserBalanceAction = await actionId(vault.instance, 'manageUserBalance');

          await vault.authorizer
            ?.connect(admin)
            .grantRoles([exitAction, batchSwapAction, manageUserBalanceAction], relayer.address);
        });

        context('when the user did allow the relayer', () => {
          sharedBeforeEach('allow relayer', async () => {
            await vault.instance.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
          });

          it('performs the given swap', async () => {
            const receipt = await relayer
              .connect(sender)
              .lidoSwapAndExit(basePoolId, recipient.address, exitRequest, swapKind, swaps, assets, limits, deadline);

            expectEvent.inIndirectReceipt(await receipt.wait(), vault.instance.interface, 'Swap', {
              poolId: metaPoolId,
              tokenIn: assets[swaps[0].assetInIndex],
              tokenOut: assets[swaps[0].assetOutIndex],
            });
          });

          it('exits the pool', async () => {
            const previousRecipientBalance = await WETH.balanceOf(recipient.address);

            const receipt = await relayer
              .connect(sender)
              .lidoSwapAndExit(basePoolId, recipient.address, exitRequest, swapKind, swaps, assets, limits, deadline);

            expectEvent.inIndirectReceipt(await receipt.wait(), vault.instance.interface, 'PoolBalanceChanged', {
              poolId: basePoolId,
              liquidityProvider: sender.address,
            });

            const currentRecipientBalance = await WETH.balanceOf(recipient.address);

            expect(currentRecipientBalance).to.be.gt(previousRecipientBalance);
          });

          it("doesn't leave dust BPT on the sender", async () => {
            const previousSenderBalance = await basePool.balanceOf(sender.address);

            await relayer
              .connect(sender)
              .lidoSwapAndExit(basePoolId, recipient.address, exitRequest, swapKind, swaps, assets, limits, deadline);

            const currentSenderBalance = await basePool.balanceOf(sender.address);

            expect(currentSenderBalance).to.be.eq(previousSenderBalance);
          });
        });

        context('when the user did not allow the relayer', () => {
          sharedBeforeEach('disallow relayer', async () => {
            await vault.instance.connect(sender).setRelayerApproval(sender.address, relayer.address, false);
          });

          it('reverts', async () => {
            await expect(
              relayer
                .connect(sender)
                .lidoSwapAndExit(basePoolId, recipient.address, exitRequest, swapKind, swaps, assets, limits, deadline)
            ).to.be.revertedWith('USER_DOESNT_ALLOW_RELAYER');
          });
        });
      });

      context('when the relayer is not allowed to swap', () => {
        it('reverts', async () => {
          await expect(
            relayer
              .connect(sender)
              .lidoSwapAndExit(basePoolId, recipient.address, exitRequest, swapKind, swaps, assets, limits, deadline)
          ).to.be.revertedWith('SENDER_NOT_ALLOWED');
        });
      });
    });
  });
});
