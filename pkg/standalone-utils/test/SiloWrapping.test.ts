import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import StablePool from '@balancer-labs/v2-helpers/src/models/pools/stable/StablePool';
import { SwapKind, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { expectTransferEvent } from '@balancer-labs/v2-helpers/src/test/expectTransfer';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { ANY_ADDRESS, MAX_INT256, MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { BigNumberish, fp } from '@balancer-labs/v2-helpers/src/numbers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';
import { Dictionary } from 'lodash';
import { expectChainedReferenceContents, toChainedReference } from './helpers/chainedReferences';

describe('SiloWrapping', function () {
  let USDC: Token, sUSDC: Token, mockSilo: Contract;
  let senderUser: SignerWithAddress, recipientUser: SignerWithAddress, admin: SignerWithAddress;
  let vault: Vault;
  let relayer: Contract, relayerLibrary: Contract;

  before('setup signer', async () => {
    [, admin, senderUser, recipientUser] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy Vault', async () => {
    vault = await Vault.create({ admin });
    // Set up and deploy tokens
    USDC = await deploy('v2-solidity-utils/TestToken', {
      args: ['USDC', 'USDC', 6],
    });

    mockSilo = await deploy('MockSilo', {
      args: [USDC.address],
    });

    sUSDC = await deploy('MockShareToken', {
      args: ['sUSDC', 'sUSDC', mockSilo.address, USDC.address, 6]
    }); 

    // initalize the asset storage mapping within the Silo for the main token
    await mockSilo.setAssetStorage(
      USDC.address, // interestBearingAsset
      sUSDC.address, // CollateralToken
      sUSDC.address, // CollateralOnlyToken (using wrapped token as a placeholder)
      sUSDC.address, // debtToken (using wrapped token as a placeholder)
      fp(20000), // totalDeposits; These values do not matter for the sack of relayer tests
      fp(100), // collateralOnlyDeposits; These values do not matter for the sack of relayer tests
      fp(9000) // totalBorrowAmount; These values do not matter for the sack of relayer tests
    );
  });

  sharedBeforeEach('mint tokens to senderUser', async () => {
    await USDC.mint(senderUser.address, fp(100));
    await sUSDC.mint(senderUser.address, fp(100));

    await USDC.connect(senderUser).approve(vault.address, fp(100));
    await sUSDC.connect(senderUser).approve(sUSDC.address, fp(100));
  });

  sharedBeforeEach('set up relayer', async () => {
    // Deploy Relayer
    relayerLibrary = await deploy('MockBatchRelayerLibrary', { args: [vault.address, ZERO_ADDRESS, ZERO_ADDRESS] });
    relayer = await deployedAt('BalancerRelayer', await relayerLibrary.getEntrypoint());

    // Authorize Relayer for all actions
    const relayerActionIds = await Promise.all(
      ['swap', 'batchSwap', 'joinPool', 'exitPool', 'setRelayerApproval', 'manageUserBalance'].map((action) =>
        actionId(vault.instance, action)
      )
    );
    const authorizer = vault.authorizer;
    const wheres = relayerActionIds.map(() => ANY_ADDRESS);
    await authorizer.connect(admin).grantPermissions(relayerActionIds, relayer.address, wheres);

    // Approve relayer by sender
    await vault.instance.connect(senderUser).setRelayerApproval(senderUser.address, relayer.address, true);
  });

  function encodeApprove(token: Token, amount: BigNumberish): string {
    return relayerLibrary.interface.encodeFunctionData('approveVault', [token.address, amount]);
  }

  function encodeWrap(
    sender: Account,
    recipient: Account,
    amount: BigNumberish,
    outputReference?: BigNumberish
  ): string {
    return relayerLibrary.interface.encodeFunctionData('wrapShareToken', [
      sUSDC.address,
      TypesConverter.toAddress(sender),
      TypesConverter.toAddress(recipient),
      amount,
      outputReference ?? 0,
    ]);
  }

  function encodeUnwrap(
    sender: Account,
    recipient: Account,
    amount: BigNumberish,
    outputReference?: BigNumberish
  ): string {
    return relayerLibrary.interface.encodeFunctionData('unwrapShareToken', [
      sUSDC.address,
      TypesConverter.toAddress(sender),
      TypesConverter.toAddress(recipient),
      amount,
      outputReference ?? 0,
    ]);
  }

  async function setChainedReferenceContents(ref: BigNumberish, value: BigNumberish): Promise<void> {
    await relayer.multicall([relayerLibrary.interface.encodeFunctionData('setChainedReferenceValue', [ref, value])]);
  }

  describe('primitives', () => {
    const amount = fp(1);

    describe('wrap USDC', () => {
      let tokenSender: Account, tokenRecipient: Account;

      context('sender = senderUser, recipient = relayer', () => {
        beforeEach(async () => {
          tokenSender = senderUser;
          tokenRecipient = relayer;
        });
        testWrap();
      });

      context('sender = senderUser, recipient = senderUser', () => {
        beforeEach(() => {
          tokenSender = senderUser;
          tokenRecipient = senderUser;
        });
        testWrap();
      });

      context('sender = relayer, recipient = relayer', () => {
        beforeEach(async () => {
          await USDC.connect(senderUser).transfer(relayer.address, amount);
          tokenSender = relayer;
          tokenRecipient = relayer;
        });
        testWrap();
      });

      context('sender = relayer, recipient = senderUser', () => {
        beforeEach(async () => {
          await USDC.connect(senderUser).transfer(relayer.address, amount);
          tokenSender = relayer;
          tokenRecipient = senderUser;
        });
        testWrap();
      });

      function testWrap(): void {
        it('wraps with immediate amounts', async () => {
          // For these tests we will do a 1:1 wrapping and unwrapping due to no exposed conversion function for Silo
          const expectedsUSDCAmount = amount;

          const receipt = await (
            await relayer.connect(senderUser).multicall([encodeWrap(tokenSender, tokenRecipient, amount)])
          ).wait();

          const relayerIsSender = TypesConverter.toAddress(tokenSender) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(tokenSender),
              to: TypesConverter.toAddress(relayerIsSender ? mockSilo : relayer),
              value: amount,
            },
            USDC
          );
          const relayerIsRecipient = TypesConverter.toAddress(tokenRecipient) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(ZERO_ADDRESS),
              to: TypesConverter.toAddress(relayerIsRecipient ? relayer : tokenRecipient),
              value: expectedsUSDCAmount,
            },
            sUSDC
          );
        });

        it('stores wrap output as chained reference', async () => {
          // For these tests we will do a 1:1 wrapping and unwrapping due to no exposed conversion function for Silo
          const expectedsUSDCAmount = amount;

          await relayer
            .connect(senderUser)
            .multicall([encodeWrap(tokenSender, tokenRecipient, amount, toChainedReference(0))]);

          await expectChainedReferenceContents(relayer, toChainedReference(0), expectedsUSDCAmount);
        });

        it('wraps with chained references', async () => {
          // For these tests we will do a 1:1 wrapping and unwrapping due to no exposed conversion function for Silo
          const expectedsUSDCAmount = amount;
          await setChainedReferenceContents(toChainedReference(0), amount);

          const receipt = await (
            await relayer
              .connect(senderUser)
              .multicall([encodeWrap(tokenSender, tokenRecipient, toChainedReference(0))])
          ).wait();

          const relayerIsSender = TypesConverter.toAddress(tokenSender) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(tokenSender),
              to: TypesConverter.toAddress(relayerIsSender ? mockSilo : relayer),
              value: amount,
            },
            USDC
          );
          const relayerIsRecipient = TypesConverter.toAddress(tokenRecipient) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(ZERO_ADDRESS),
              to: TypesConverter.toAddress(relayerIsRecipient ? relayer : tokenRecipient),
              value: expectedsUSDCAmount,
            },
            sUSDC
          );
        });
      }
    });

    describe('unwrap sUSDC', () => {
      let tokenSender: Account, tokenRecipient: Account;

      context('sender = senderUser, recipient = relayer', () => {
        beforeEach(async () => {
          await sUSDC.connect(senderUser).approve(vault.address, fp(10));
          tokenSender = senderUser;
          tokenRecipient = relayer;
        });
        testUnwrap();
      });

      context('sender = senderUser, recipient = senderUser', () => {
        beforeEach(async () => {
          await sUSDC.connect(senderUser).approve(vault.address, fp(10));
          tokenSender = senderUser;
          tokenRecipient = senderUser;
        });
        testUnwrap();
      });

      context('sender = relayer, recipient = relayer', () => {
        beforeEach(async () => {
          await sUSDC.connect(senderUser).transfer(relayer.address, amount);
          tokenSender = relayer;
          tokenRecipient = relayer;
        });
        testUnwrap();
      });

      context('sender = relayer, recipient = senderUser', () => {
        beforeEach(async () => {
          await sUSDC.connect(senderUser).transfer(relayer.address, amount);
          tokenSender = relayer;
          tokenRecipient = senderUser;
        });
        testUnwrap();
      });

      function testUnwrap(): void {
        it('unwraps with immediate amounts', async () => {
          const receipt = await (
            await relayer.connect(senderUser).multicall([encodeUnwrap(tokenSender, tokenRecipient, amount)])
          ).wait();

          const relayerIsSender = TypesConverter.toAddress(tokenSender) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(tokenSender),
              to: TypesConverter.toAddress(relayerIsSender ? ZERO_ADDRESS : relayer),
              value: amount,
            },
            sUSDC
          );
          const relayerIsRecipient = TypesConverter.toAddress(tokenRecipient) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: ZERO_ADDRESS,
              to: TypesConverter.toAddress(relayerIsRecipient ? relayer : tokenRecipient),
              value: amount,
            },
            USDC
          );
        });

        it('stores unwrap output as chained reference', async () => {
          await relayer
            .connect(senderUser)
            .multicall([encodeUnwrap(tokenSender, tokenRecipient, amount, toChainedReference(0))]);

          const usdcAmount = amount;
          await expectChainedReferenceContents(relayer, toChainedReference(0), usdcAmount);
        });

        it('unwraps with chained references', async () => {
          await setChainedReferenceContents(toChainedReference(0), amount);

          const receipt = await (
            await relayer
              .connect(senderUser)
              .multicall([encodeUnwrap(tokenSender, tokenRecipient, amount, toChainedReference(0))])
          ).wait();

          const relayerIsSender = TypesConverter.toAddress(tokenSender) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: TypesConverter.toAddress(tokenSender),
              to: TypesConverter.toAddress(relayerIsSender ? ZERO_ADDRESS : relayer),
              value: amount,
            },
            sUSDC
          );
          const relayerIsRecipient = TypesConverter.toAddress(tokenRecipient) === relayer.address;
          expectTransferEvent(
            receipt,
            {
              from: ZERO_ADDRESS,
              to: TypesConverter.toAddress(relayerIsRecipient ? relayer : tokenRecipient),
              value: amount,
            },
            USDC
          );
        });
      }
    });
  });

  // describe('complex actions', () => {
  //   let WETH: Token, USDCToken: Token, sUSDCToken: Token;
  //   let poolTokens: TokenList;
  //   let poolId: string;
  //   let pool: StablePool;
  //   let bptIndex: number;

  //   sharedBeforeEach('deploy pool', async () => {
  //     WETH = await Token.deployedAt(await vault.instance.WETH());
  //     USDCToken = await Token.deployedAt(await USDC.address);
  //     sUSDCToken = await Token.deployedAt(await sUSDC.address);
  //     poolTokens = new TokenList([WETH, sUSDCToken]).sort();

  //     pool = await StablePool.create({ tokens: poolTokens, vault });
  //     poolId = pool.poolId;

  //     await WETH.mint(senderUser, fp(2));
  //     await WETH.approve(vault, MAX_UINT256, { from: senderUser });

  //     // Seed liquidity in pool
  //     await WETH.mint(admin, fp(200));
  //     await WETH.approve(vault, MAX_UINT256, { from: admin });

  //     await USDCToken.mint(admin, fp(150));
  //     await USDCToken.approve(sUSDC, fp(150), { from: admin });
  //     // await sUSDCToken.connect(admin).wrap(fp(150));
  //     await sUSDCToken.approve(vault, MAX_UINT256, { from: admin });

  //     bptIndex = await pool.getBptIndex();
  //     const initialBalances = Array.from({ length: 3 }).map((_, i) => (i == bptIndex ? 0 : fp(100)));

  //     await pool.init({ initialBalances, from: admin });
  //   });

  //   describe('swap', () => {
  //     function encodeSwap(params: {
  //       poolId: string;
  //       kind: SwapKind;
  //       tokenIn: Token;
  //       tokenOut: Token;
  //       amount: BigNumberish;
  //       sender: Account;
  //       recipient: Account;
  //       outputReference?: BigNumberish;
  //     }): string {
  //       return relayerLibrary.interface.encodeFunctionData('swap', [
  //         {
  //           poolId: params.poolId,
  //           kind: params.kind,
  //           assetIn: params.tokenIn.address,
  //           assetOut: params.tokenOut.address,
  //           amount: params.amount,
  //           userData: '0x',
  //         },
  //         {
  //           sender: TypesConverter.toAddress(params.sender),
  //           recipient: TypesConverter.toAddress(params.recipient),
  //           fromInternalBalance: false,
  //           toInternalBalance: false,
  //         },
  //         0,
  //         MAX_UINT256,
  //         0,
  //         params.outputReference ?? 0,
  //       ]);
  //     }

  //     describe('swap using USDC as an input', () => {
  //       let receipt: ContractReceipt;
  //       const amount = fp(1);

  //       sharedBeforeEach('swap USDC for WETH', async () => {
  //         receipt = await (
  //           await relayer.connect(senderUser).multicall([
  //             encodeWrap(senderUser.address, relayer.address, amount, toChainedReference(0)),
  //             encodeApprove(sUSDC, MAX_UINT256),
  //             encodeSwap({
  //               poolId,
  //               kind: SwapKind.GivenIn,
  //               tokenIn: sUSDC,
  //               tokenOut: WETH,
  //               amount: toChainedReference(0),
  //               sender: relayer,
  //               recipient: recipientUser,
  //               outputReference: 0,
  //             }),
  //           ])
  //         ).wait();
  //       });

  //       it('performs the given swap', async () => {
  //         expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
  //           poolId,
  //           tokenIn: sUSDC.address,
  //           tokenOut: WETH.address,
  //         });

  //         expectTransferEvent(receipt, { from: vault.address, to: recipientUser.address }, WETH);
  //       });

  //       it('does not leave dust on the relayer', async () => {
  //         expect(await WETH.balanceOf(relayer)).to.be.eq(0);
  //         expect(await sUSDCToken.balanceOf(relayer)).to.be.eq(0);
  //       });
  //     });

  //     describe('swap using USDC as an output', () => {
  //       let receipt: ContractReceipt;
  //       const amount = fp(1);

  //       sharedBeforeEach('swap WETH for USDC', async () => {
  //         receipt = await (
  //           await relayer.connect(senderUser).multicall([
  //             encodeSwap({
  //               poolId,
  //               kind: SwapKind.GivenIn,
  //               tokenIn: WETH,
  //               tokenOut: sUSDCToken,
  //               amount,
  //               sender: senderUser,
  //               recipient: relayer,
  //               outputReference: toChainedReference(0),
  //             }),
  //             encodeUnwrap(relayer.address, recipientUser.address, toChainedReference(0)),
  //           ])
  //         ).wait();
  //       });

  //       it('performs the given swap', async () => {
  //         expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
  //           poolId,
  //           tokenIn: WETH.address,
  //           tokenOut: sUSDCToken.address,
  //         });

  //         expectTransferEvent(receipt, { from: ZERO_ADDRESS, to: recipientUser.address }, USDC);
  //       });

  //       it('does not leave dust on the relayer', async () => {
  //         expect(await WETH.balanceOf(relayer)).to.be.eq(0);
  //         expect(await sUSDCToken.balanceOf(relayer)).to.be.eq(0);
  //       });
  //     });
  //   });

  //   describe('batchSwap', () => {
  //     function encodeBatchSwap(params: {
  //       swaps: Array<{
  //         poolId: string;
  //         tokenIn: Token;
  //         tokenOut: Token;
  //         amount: BigNumberish;
  //       }>;
  //       sender: Account;
  //       recipient: Account;
  //       outputReferences?: Dictionary<BigNumberish>;
  //     }): string {
  //       const outputReferences = Object.entries(params.outputReferences ?? {}).map(([symbol, key]) => ({
  //         index: poolTokens.findIndexBySymbol(symbol),
  //         key,
  //       }));

  //       return relayerLibrary.interface.encodeFunctionData('batchSwap', [
  //         SwapKind.GivenIn,
  //         params.swaps.map((swap) => ({
  //           poolId: swap.poolId,
  //           assetInIndex: poolTokens.indexOf(swap.tokenIn),
  //           assetOutIndex: poolTokens.indexOf(swap.tokenOut),
  //           amount: swap.amount,
  //           userData: '0x',
  //         })),
  //         poolTokens.addresses,
  //         {
  //           sender: TypesConverter.toAddress(params.sender),
  //           recipient: TypesConverter.toAddress(params.recipient),
  //           fromInternalBalance: false,
  //           toInternalBalance: false,
  //         },
  //         new Array(poolTokens.length).fill(MAX_INT256),
  //         MAX_UINT256,
  //         0,
  //         outputReferences,
  //       ]);
  //     }

  //     describe('swap using USDC as an input', () => {
  //       let receipt: ContractReceipt;
  //       const amount = fp(1);

  //       sharedBeforeEach('swap USDC for WETH', async () => {
  //         receipt = await (
  //           await relayer.connect(senderUser).multicall([
  //             encodeWrap(senderUser.address, relayer.address, amount, toChainedReference(0)),
  //             encodeApprove(sUSDCToken, MAX_UINT256),
  //             encodeBatchSwap({
  //               swaps: [{ poolId, tokenIn: sUSDCToken, tokenOut: WETH, amount: toChainedReference(0) }],
  //               sender: relayer,
  //               recipient: recipientUser,
  //             }),
  //           ])
  //         ).wait();
  //       });

  //       it('performs the given swap', async () => {
  //         expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
  //           poolId: poolId,
  //           tokenIn: sUSDC.address,
  //           tokenOut: WETH.address,
  //         });

  //         expectTransferEvent(receipt, { from: vault.address, to: recipientUser.address }, WETH);
  //       });

  //       it('does not leave dust on the relayer', async () => {
  //         expect(await WETH.balanceOf(relayer)).to.be.eq(0);
  //         expect(await sUSDCToken.balanceOf(relayer)).to.be.eq(0);
  //       });
  //     });

  //     describe('swap using USDC as an output', () => {
  //       let receipt: ContractReceipt;
  //       const amount = fp(1);

  //       sharedBeforeEach('swap WETH for USDC', async () => {
  //         receipt = await (
  //           await relayer.connect(senderUser).multicall([
  //             encodeBatchSwap({
  //               swaps: [{ poolId, tokenIn: WETH, tokenOut: sUSDCToken, amount }],
  //               sender: senderUser,
  //               recipient: relayer,
  //               outputReferences: { sUSDC: toChainedReference(0) },
  //             }),
  //             encodeUnwrap(relayer.address, recipientUser.address, toChainedReference(0)),
  //           ])
  //         ).wait();
  //       });

  //       it('performs the given swap', async () => {
  //         expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
  //           poolId: poolId,
  //           tokenIn: WETH.address,
  //           tokenOut: sUSDC.address,
  //         });

  //         expectTransferEvent(receipt, { from: ZERO_ADDRESS, to: recipientUser.address }, USDC);
  //       });

  //       it('does not leave dust on the relayer', async () => {
  //         expect(await WETH.balanceOf(relayer)).to.be.eq(0);
  //         expect(await sUSDCToken.balanceOf(relayer)).to.be.eq(0);
  //       });
  //     });
  //   });

  //   describe('joinPool', () => {
  //     function encodeJoin(params: {
  //       poolId: string;
  //       sender: Account;
  //       recipient: Account;
  //       assets: string[];
  //       maxAmountsIn: BigNumberish[];
  //       userData: string;
  //       outputReference?: BigNumberish;
  //     }): string {
  //       return relayerLibrary.interface.encodeFunctionData('joinPool', [
  //         params.poolId,
  //         0, // WeightedPool
  //         TypesConverter.toAddress(params.sender),
  //         TypesConverter.toAddress(params.recipient),
  //         {
  //           assets: params.assets,
  //           maxAmountsIn: params.maxAmountsIn,
  //           userData: params.userData,
  //           fromInternalBalance: false,
  //         },
  //         0,
  //         params.outputReference ?? 0,
  //       ]);
  //     }

  //     let receipt: ContractReceipt;
  //     let sendersUSDCBalanceBefore: BigNumber;
  //     const amount = fp(1);

  //     sharedBeforeEach('join the pool', async () => {
  //       const { tokens: allTokens } = await pool.getTokens();

  //       sendersUSDCBalanceBefore = await sUSDCToken.balanceOf(senderUser);
  //       receipt = await (
  //         await relayer.connect(senderUser).multicall([
  //           encodeWrap(senderUser.address, relayer.address, amount, toChainedReference(0)),
  //           encodeApprove(sUSDCToken, MAX_UINT256),
  //           encodeJoin({
  //             poolId,
  //             assets: allTokens,
  //             sender: relayer,
  //             recipient: recipientUser,
  //             maxAmountsIn: Array(poolTokens.length + 1).fill(MAX_UINT256),
  //             userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(
  //               poolTokens.map((token) => (token === sUSDCToken ? toChainedReference(0) : 0)),
  //               0
  //             ),
  //           }),
  //         ])
  //       ).wait();
  //     });

  //     it('joins the pool', async () => {
  //       expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'PoolBalanceChanged', {
  //         poolId,
  //         liquidityProvider: relayer.address,
  //       });

  //       // BPT minted to recipient
  //       expectTransferEvent(receipt, { from: ZERO_ADDRESS, to: recipientUser.address }, pool);
  //     });

  //     it('does not take sUSDC from the user', async () => {
  //       const sendersUSDCBalanceAfter = await sUSDCToken.balanceOf(senderUser);
  //       expect(sendersUSDCBalanceAfter).to.be.eq(sendersUSDCBalanceBefore);
  //     });

  //     it('does not leave dust on the relayer', async () => {
  //       expect(await WETH.balanceOf(relayer)).to.be.eq(0);
  //       expect(await sUSDCToken.balanceOf(relayer)).to.be.eq(0);
  //     });
  //   });
  // });
});
