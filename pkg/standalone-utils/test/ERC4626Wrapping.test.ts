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

describe('ERC4626Wrapping', function () {

  // erc4626 is wrappedToken for LinearPool
  let erc4626: Token, erc4626Asset: Token, mainToken: Token;
  let senderUser: SignerWithAddress, recipientUser: SignerWithAddress, admin: SignerWithAddress,
    owner: SignerWithAddress;
  let vault: Vault;
  let relayer: Contract, relayerLibrary: Contract;


  before('setup signer', async () => {
    [, admin, senderUser, recipientUser, owner] = await ethers.getSigners();
  });


  sharedBeforeEach('deploy Vault', async () => {
    vault = await Vault.create({ admin });

    // need mainToken
    const USDCContract = await deploy('TestToken', { args: ['USDC', 'USDC', 6] });
    mainToken = new Token('USDC', 'USDC', 6, USDCContract);

    const erc4626AssetContract = await deploy('TestToken', { args: ['UsdPlus', 'UsdPlus', 6] });
    erc4626Asset = new Token('UsdPlus', 'UsdPlus', 6, erc4626AssetContract);

    const erc4626Contract = await deploy('MockERC4626Token', {
      args: ['staticUsdPlus', 'staticUsdPlus', 6, erc4626Asset.address]
    });
    erc4626 = new Token('staticUsdPlus', 'staticUsdPlus', 6, erc4626Contract);

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

  // erc4626Asset -> erc4626
  function encodeWrap(
    wrappedToken: Token,
    sender: Account,
    recipient: Account,
    amount: BigNumberish,
    outputReference?: BigNumberish
  ): string {
    return relayerLibrary.interface.encodeFunctionData('wrapERC4626', [
      TypesConverter.toAddress(wrappedToken),
      TypesConverter.toAddress(sender),
      TypesConverter.toAddress(recipient),
      amount,
      outputReference ?? 0,
    ]);
  }

  // erc4626 -> erc4626Asset
  function encodeUnwrap(
    wrappedToken: Token,
    sender: Account,
    recipient: Account,
    amount: BigNumberish,
    outputReference?: BigNumberish
  ): string {
    return relayerLibrary.interface.encodeFunctionData('unwrapERC4626', [
      TypesConverter.toAddress(wrappedToken),
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
      poolTokens = new TokenList([mainToken, erc4626]).sort();

      upperTarget = fp(2000);
      await deployPool({ mainToken: mainToken, wrappedToken: erc4626, upperTarget, vault }, false);
      await pool.initialize();
      poolId = pool.poolId;

      // give mainToken to user
      await mainToken.mint(senderUser, fp(10));
      await mainToken.approve(vault, MAX_UINT256, { from: senderUser });

      await erc4626Asset.mint(senderUser, fp(10));
      await erc4626Asset.approve(vault, MAX_UINT256, { from: senderUser });


      // Seed liquidity in pool 200 mainToken and 150 erc4626
      await mainToken.mint(admin, fp(200));
      await mainToken.approve(vault, MAX_UINT256, { from: admin });

      await erc4626Asset.mint(admin, fp(150));
      await erc4626Asset.approve(erc4626, MAX_UINT256, { from: admin });

      // should use wrap() for worked transfers
      await erc4626.instance.connect(admin).deposit(fp(150), TypesConverter.toAddress(admin));
      await erc4626.approve(vault, MAX_UINT256, { from: admin });


      const currentBalances = await pool.getBalances();
      expect(currentBalances[pool.mainIndex]).to.be.equal(0);
      expect(currentBalances[pool.wrappedIndex]).to.be.equal(0);


      await pool.vault.generalSwap({
        poolId,
        kind: SwapKind.GivenIn,
        tokenIn: TypesConverter.toAddress(mainToken),
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
        tokenIn: TypesConverter.toAddress(erc4626),
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

      describe('swap using erc4626Asset as an input', () => {
        let receipt: ContractReceipt;
        const amount = fp(1);

        sharedBeforeEach('swap erc4626Asset for mainToken', async () => {
          receipt = await (
            await relayer.connect(senderUser).multicall([
              // erc4626Asset -> erc4626 by wrapUsdPlusDynamicToken on UsdPlusWrapping
              encodeWrap(erc4626, senderUser.address, relayer.address, amount, toChainedReference(0)),
              // approve vault to use tokens on relayer
              encodeApprove(erc4626, MAX_UINT256),
              // erc4626 -> mainToken by swap on LinearPool
              encodeSwap({
                poolId,
                kind: SwapKind.GivenIn,
                tokenIn: erc4626,
                tokenOut: mainToken,
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
            tokenIn: erc4626.address,
            tokenOut: mainToken.address,
          });

          expectTransferEvent(receipt, { from: vault.address, to: recipientUser.address }, mainToken);
        });

        it('does not leave dust on the relayer', async () => {
          expect(await mainToken.balanceOf(relayer)).to.be.eq(0);
          expect(await erc4626Asset.balanceOf(relayer)).to.be.eq(0);
          expect(await erc4626.balanceOf(relayer)).to.be.eq(0);
        });
      });

      describe('swap using erc4626Asset as an output', () => {
        let receipt: ContractReceipt;
        const amount = fp(1);

        sharedBeforeEach('swap mainToken for erc4626Asset', async () => {
          receipt = await (
            await relayer.connect(senderUser).multicall([
              // mainToken -> erc4626 by swap on LinearPool
              encodeSwap({
                poolId,
                kind: SwapKind.GivenIn,
                tokenIn: mainToken,
                tokenOut: erc4626,
                amount,
                sender: senderUser,
                recipient: relayer,
                outputReference: toChainedReference(0),
              }),
              // erc4626 -> erc4626Asset by unwrapUsdPlusStaticToken on UsdPlusWrapping
              encodeUnwrap(erc4626, relayer.address, recipientUser.address, toChainedReference(0)),
            ])
          ).wait();
        });

        it('performs the given swap', async () => {

          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
            poolId,
            tokenIn: mainToken.address,
            tokenOut: erc4626.address,
          });

          expectTransferEvent(receipt, { from: erc4626.address, to: recipientUser.address }, erc4626Asset);
        });

        it('does not leave dust on the relayer', async () => {
          expect(await mainToken.balanceOf(relayer)).to.be.eq(0);
          expect(await erc4626Asset.balanceOf(relayer)).to.be.eq(0);
          expect(await erc4626.balanceOf(relayer)).to.be.eq(0);
        });
      });
    });

  });
});
