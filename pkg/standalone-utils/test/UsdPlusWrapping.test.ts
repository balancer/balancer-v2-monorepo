import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { SwapKind } from '@balancer-labs/balancer-js';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { ANY_ADDRESS, MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { BigNumberish, bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';
import LinearPool from "@balancer-labs/v2-helpers/src/models/pools/linear/LinearPool";
import { RawLinearPoolDeployment } from "@balancer-labs/v2-helpers/src/models/pools/linear/types";
import { sharedBeforeEach } from "@balancer-labs/v2-common/sharedBeforeEach";

describe('UsdPlusWrapping', function () {

  let staticUsdPlus: Token, UsdPlus: Token, USDC: Token;
  let senderUser: SignerWithAddress, recipientUser: SignerWithAddress, admin: SignerWithAddress,
    owner: SignerWithAddress;
  let vault: Vault;
  let relayer: Contract, relayerLibrary: Contract;


  before('setup signer', async () => {
    [, admin, senderUser, recipientUser, owner] = await ethers.getSigners();
  });


  sharedBeforeEach('deploy Vault', async () => {
    vault = await Vault.create({ admin });

    // need USDC
    const USDCContract = await deploy('TestToken', { args: ['USDC', 'USDC', 6] });
    USDC = new Token('USDC', 'USDC', 6, USDCContract);

    const UsdPlusContract = await deploy('TestToken', { args: ['UsdPlus', 'UsdPlus', 6] });
    UsdPlus = new Token('UsdPlus', 'UsdPlus', 6, UsdPlusContract);

    const staticUsdPlusContract = await deploy('MockStaticUsdPlusToken', {
      args: ['staticUsdPlus', 'staticUsdPlus', 6, USDC.address, UsdPlus.address]
    });
    staticUsdPlus = new Token('staticUsdPlus', 'staticUsdPlus', 6, staticUsdPlusContract);

  });

  sharedBeforeEach('set up relayer', async () => {
    // // Deploy Relayer, ZERO_ADDRESS for LidoWrapping init
    relayerLibrary = await deploy('MockBatchRelayerLibrary', { args: [vault.address, ZERO_ADDRESS] });

    // Deploy Relayer
    // relayerLibrary = await deploy('MockBaseRelayerLibrary', { args: [vault.address] });
    relayer = await deployedAt('BalancerRelayer', await relayerLibrary.getEntrypoint());

    // Authorize Relayer for all actions
    const relayerActionIds = await Promise.all(
      ['swap', 'batchSwap', 'joinPool', 'exitPool', 'setRelayerApproval', 'manageUserBalance'].map((action) =>
        actionId(vault.instance, action)
      )
    );
    const authorizer = await deployedAt('v2-vault/Authorizer', await vault.instance.getAuthorizer());
    const wheres = relayerActionIds.map(() => ANY_ADDRESS);
    await authorizer.connect(admin).grantPermissions(relayerActionIds, relayer.address, wheres);

    // Approve relayer by sender
    await vault.instance.connect(senderUser).setRelayerApproval(senderUser.address, relayer.address, true);
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

  // UsdcPlus -> staticUsdPlus
  function encodeWrap(
    usdPlus: Token,
    sender: Account,
    recipient: Account,
    amount: BigNumberish,
    outputReference?: BigNumberish
  ): string {
    return relayerLibrary.interface.encodeFunctionData('wrapUsdPlusDynamicToken', [
      TypesConverter.toAddress(usdPlus),
      TypesConverter.toAddress(sender),
      TypesConverter.toAddress(recipient),
      amount,
      outputReference ?? 0,
    ]);
  }

  // staticUsdPlus -> UsdcPlus
  function encodeUnwrap(
    staticToken: Token,
    sender: Account,
    recipient: Account,
    amount: BigNumberish,
    outputReference?: BigNumberish
  ): string {
    return relayerLibrary.interface.encodeFunctionData('unwrapUsdPlusStaticToken', [
      TypesConverter.toAddress(staticToken),
      TypesConverter.toAddress(sender),
      TypesConverter.toAddress(recipient),
      amount,
      outputReference ?? 0,
    ]);
  }

  function expectTransferEvent(
    receipt: ContractReceipt,
    args: { from?: string; to?: string; value?: BigNumberish },
    token: Token
  ) {
    return expectEvent.inIndirectReceipt(receipt, token.instance.interface, 'Transfer', args, token.address);
  }

  describe('complex actions', () => {
    let poolTokens: TokenList;
    let poolId: string;
    let pool: LinearPool;

    let upperTarget: BigNumber;
    const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);

    async function deployPool(params: RawLinearPoolDeployment, mockedVault = true): Promise<void> {
      params = Object.assign({}, { swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE, owner, admin }, params);
      pool = await LinearPool.create(params, mockedVault);
    }

    sharedBeforeEach('deploy pool', async () => {
      poolTokens = new TokenList([USDC, staticUsdPlus]).sort();

      upperTarget = fp(2000);
      await deployPool({ mainToken: USDC, wrappedToken: staticUsdPlus, upperTarget, vault }, false);
      await pool.initialize();
      poolId = pool.poolId;

      // give USDC to user
      await USDC.mint(senderUser, fp(10));
      await USDC.approve(vault, MAX_UINT256, { from: senderUser });

      await UsdPlus.mint(senderUser, fp(10));
      await UsdPlus.approve(vault, MAX_UINT256, { from: senderUser });


      // Seed liquidity in pool 200 USDC and 150 staticUsdPlus
      await USDC.mint(admin, fp(200));
      await USDC.approve(vault, MAX_UINT256, { from: admin });

      await UsdPlus.mint(admin, fp(150));
      await UsdPlus.approve(staticUsdPlus, MAX_UINT256, { from: admin });

      // should use wrap() for worked transfers
      await staticUsdPlus.instance.connect(admin).wrap(TypesConverter.toAddress(admin), fp(150));
      await staticUsdPlus.approve(vault, MAX_UINT256, { from: admin });


      const currentBalances = await pool.getBalances();
      expect(currentBalances[pool.mainIndex]).to.be.equal(0);
      expect(currentBalances[pool.wrappedIndex]).to.be.equal(0);


      await pool.vault.generalSwap({
        poolId,
        kind: SwapKind.GivenIn,
        tokenIn: TypesConverter.toAddress(USDC),
        tokenOut: TypesConverter.toAddress(pool),
        amount: fp(200),
        data: "0x",
        from: admin,
        to: admin.address,
        // unused in generalSwap for mockVault=false
        lastChangeBlock: bn(0),
        poolAddress: "",
        balances: [],
        indexIn: 0,
        indexOut: 2,
      });

      await pool.vault.generalSwap({
        poolId,
        kind: SwapKind.GivenIn,
        tokenIn: TypesConverter.toAddress(staticUsdPlus),
        tokenOut: TypesConverter.toAddress(pool),
        amount: fp(150),
        data: "0x",
        from: admin,
        to: admin.address,
        // unused in generalSwap for mockVault=false
        lastChangeBlock: bn(0),
        poolAddress: "",
        balances: [],
        indexIn: 0,
        indexOut: 2,
      });

      const seededBalances = await pool.getBalances();
      expect(seededBalances[pool.mainIndex]).to.be.equal(fp(200));
      expect(seededBalances[pool.wrappedIndex]).to.be.equal(fp(150));

    });


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

      describe('swap using UsdPlus as an input', () => {
        let receipt: ContractReceipt;
        const amount = fp(1);

        sharedBeforeEach('swap UsdPlus for USDC', async () => {
          receipt = await (
            await relayer.connect(senderUser).multicall([
              // UsdPlus -> staticUsdPlus by wrapUsdPlusDynamicToken on UsdPlusWrapping
              encodeWrap(staticUsdPlus, senderUser.address, relayer.address, amount, toChainedReference(0)),
              // approve vault to use tokens on relayer
              encodeApprove(staticUsdPlus, MAX_UINT256),
              // staticUsdPlus -> USDC by swap on LinearPool
              encodeSwap({
                poolId,
                kind: SwapKind.GivenIn,
                tokenIn: staticUsdPlus,
                tokenOut: USDC,
                amount: toChainedReference(0),
                sender: relayer,
                recipient: recipientUser,
                outputReference: 0
              }),
            ])
          ).wait();
        });

        it('performs the given swap', async () => {

          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
            poolId,
            tokenIn: staticUsdPlus.address,
            tokenOut: USDC.address,
          });

          expectTransferEvent(receipt, { from: vault.address, to: recipientUser.address }, USDC);
        });

        it('does not leave dust on the relayer', async () => {
          expect(await USDC.balanceOf(relayer)).to.be.eq(0);
          expect(await UsdPlus.balanceOf(relayer)).to.be.eq(0);
          expect(await staticUsdPlus.balanceOf(relayer)).to.be.eq(0);
        });
      });

      describe('swap using UsdPlus as an output', () => {
        let receipt: ContractReceipt;
        const amount = fp(1);

        sharedBeforeEach('swap USDC for UsdPlus', async () => {
          receipt = await (
            await relayer.connect(senderUser).multicall([
              // USDC -> staticUsdPlus by swap on LinearPool
              encodeSwap({
                poolId,
                kind: SwapKind.GivenIn,
                tokenIn: USDC,
                tokenOut: staticUsdPlus,
                amount,
                sender: senderUser,
                recipient: relayer,
                outputReference: toChainedReference(0),
              }),
              // staticUsdPlus -> UsdPlus by unwrapUsdPlusStaticToken on UsdPlusWrapping
              encodeUnwrap(staticUsdPlus, relayer.address, recipientUser.address, toChainedReference(0)),
            ])
          ).wait();
        });

        it('performs the given swap', async () => {

          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
            poolId,
            tokenIn: USDC.address,
            tokenOut: staticUsdPlus.address,
          });

          expectTransferEvent(receipt, { from: staticUsdPlus.address, to: recipientUser.address }, UsdPlus);
        });

        it('does not leave dust on the relayer', async () => {
          expect(await USDC.balanceOf(relayer)).to.be.eq(0);
          expect(await UsdPlus.balanceOf(relayer)).to.be.eq(0);
          expect(await staticUsdPlus.balanceOf(relayer)).to.be.eq(0);
        });
      });
    });

  });
});
