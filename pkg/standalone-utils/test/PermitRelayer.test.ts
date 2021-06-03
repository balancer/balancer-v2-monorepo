import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { GeneralPool } from '@balancer-labs/v2-helpers/src/models/vault/pools';
import { encodeExit, encodeJoin } from '@balancer-labs/v2-helpers/src/models/pools/mockPool';
import {
  encodeCalldataAuthorization,
  signBatchSwapAuthorization,
  signExitAuthorization,
  signJoinAuthorization,
  signPermit,
  signSetRelayerApprovalAuthorization,
  signSwapAuthorization,
} from '@balancer-labs/v2-helpers/src/models/misc/signatures';

import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

import { bn } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';

const tokenInitialBalance = bn(200e18);

const setup = async () => {
  const [minter, lp] = await ethers.getSigners();

  // Deploy Balancer Vault
  const vault = await Vault.create();

  const daiInstance = await deploy('TestDAI', { args: [minter.address, 'DAI', 'DAI', 18] });
  const dai = new Token('DAI', 'DAI', 18, daiInstance);
  const weth = new Token('WETH', 'WETH', 18, await deployedAt('TestWETH', await vault.instance.WETH()));
  const mkr = await Token.create('MKR');
  const tokens = new TokenList([dai, weth, mkr]);

  // Deploy Pool
  const pool = await deploy('v2-vault/test/MockPool', { args: [vault.address, GeneralPool] });
  const poolId = await pool.getPoolId();

  await tokens.mint({ to: lp, amount: tokenInitialBalance.mul(2) });
  await tokens.approve({ to: vault.address, from: [lp] });

  await pool.registerTokens(tokens.addresses, [ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS]);

  await vault.joinPool({
    poolId,
    from: lp,
    recipient: lp.address,
    tokens: tokens.addresses,
    maxAmountsIn: tokens.addresses.map(() => MAX_UINT256),
    fromInternalBalance: false,
    data: encodeJoin(
      tokens.addresses.map(() => tokenInitialBalance),
      tokens.addresses.map(() => 0)
    ),
  } as any);

  await tokens.approve({ to: vault.address, from: [lp], amount: 0 });

  const relayer = await deploy('PermitRelayer', { args: [vault.address] });

  return {
    data: {
      poolId,
    },
    contracts: {
      tokens,
      pool,
      relayer,
      vault,
    },
  };
};

describe('PermitRelayer', function () {
  let tokens: TokenList, relayer: Contract, vault: Vault;

  let signer: SignerWithAddress;
  let poolId: string;

  let daiPermit: string, mkrPermit: string;
  let dai: Token, weth: Token, mkr: Token;

  before('deploy base contracts', async () => {
    [, signer] = await ethers.getSigners();
  });

  sharedBeforeEach('set up relayer', async () => {
    const { data, contracts } = await setup();
    poolId = data.poolId;

    tokens = contracts.tokens;
    relayer = contracts.relayer;
    vault = contracts.vault;

    [dai, weth, mkr] = tokens.tokens;

    const daiSig = await signPermit(dai.instance, signer, vault.instance, MAX_UINT256);
    const mkrSig = await signPermit(mkr.instance, signer, vault.instance, MAX_UINT256);

    daiPermit = relayer.interface.encodeFunctionData('vaultPermitDAI', [
      dai.address,
      daiSig.nonce,
      MAX_UINT256,
      true,
      daiSig.v,
      daiSig.r,
      daiSig.s,
    ]);
    mkrPermit = relayer.interface.encodeFunctionData('vaultPermit', [
      mkr.address,
      MAX_UINT256,
      MAX_UINT256,
      mkrSig.v,
      mkrSig.r,
      mkrSig.s,
    ]);
  });

  context('when relayer is authorised by governance', () => {
    sharedBeforeEach('authorise relayer', async () => {
      const single = await actionId(vault.instance, 'swap');
      const batch = await actionId(vault.instance, 'batchSwap');
      const manageUserBalance = await actionId(vault.instance, 'manageUserBalance');
      const joinPool = await actionId(vault.instance, 'joinPool');
      const exitPool = await actionId(vault.instance, 'exitPool');
      const setApproval = await actionId(vault.instance, 'setRelayerApproval');
      await vault.authorizer?.grantRoles(
        [single, batch, manageUserBalance, joinPool, exitPool, setApproval],
        relayer.address
      );
    });

    describe('setRelayerApproval', () => {
      it('approves the relayer to act for sender', async () => {
        const approval = vault.instance.interface.encodeFunctionData('setRelayerApproval', [
          signer.address,
          relayer.address,
          true,
        ]);
        const signature = await signSetRelayerApprovalAuthorization(vault.instance, signer, relayer, approval);
        const callAuthorisation = encodeCalldataAuthorization('0x', MAX_UINT256, signature);

        const tx = await relayer.connect(signer).setRelayerApproval(relayer.address, true, callAuthorisation);
        const receipt = await tx.wait();

        expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'RelayerApprovalChanged', {
          relayer: relayer.address,
          sender: signer.address,
          approved: true,
        });
      });
    });

    describe('multicall', () => {
      context('when approved by sender', () => {
        sharedBeforeEach('approve relayer for sender', async () => {
          const approval = vault.instance.interface.encodeFunctionData('setRelayerApproval', [
            signer.address,
            relayer.address,
            true,
          ]);
          const signature = await signSetRelayerApprovalAuthorization(vault.instance, signer, relayer, approval);
          const callAuthorisation = encodeCalldataAuthorization('0x', MAX_UINT256, signature);

          await relayer.connect(signer).setRelayerApproval(relayer.address, true, callAuthorisation);
        });

        it('allows calling permit on multiple tokens', async () => {
          await relayer.connect(signer).multicall([daiPermit, mkrPermit]);

          expect(await dai.instance.allowance(signer.address, vault.address)).to.be.eq(MAX_UINT256);
          expect(await mkr.instance.allowance(signer.address, vault.address)).to.be.eq(MAX_UINT256);
        });

        it('allows performing a swap using permit', async () => {
          const singleSwap = {
            poolId,
            kind: 0,
            assetIn: dai.address,
            assetOut: mkr.address,
            amount: 100,
            userData: '0x',
          };
          const funds = {
            sender: signer.address,
            fromInternalBalance: false,
            recipient: signer.address,
            toInitialBalance: false,
          };

          const swap = relayer.interface.encodeFunctionData('swap', [singleSwap, funds, 1, MAX_UINT256, 0]);

          const tx = await relayer.connect(signer).multicall([daiPermit, swap]);
          const receipt = await tx.wait();

          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
            poolId,
            tokenIn: singleSwap.assetIn,
            tokenOut: singleSwap.assetOut,
            amountIn: singleSwap.amount,
            amountOut: singleSwap.amount,
          });
        });

        it('allows performing a batch swap using permit', async () => {
          const singleSwap = {
            poolId,
            assetInIndex: 0,
            assetOutIndex: 1,
            amount: 100,
            userData: '0x',
          };
          const funds = {
            sender: signer.address,
            fromInternalBalance: false,
            recipient: signer.address,
            toInitialBalance: false,
          };

          const batchSwap = relayer.interface.encodeFunctionData('batchSwap', [
            0,
            [singleSwap],
            [dai.address, mkr.address],
            funds,
            [100, -100],
            MAX_UINT256,
            0,
          ]);

          const tx = await relayer.connect(signer).multicall([daiPermit, batchSwap]);
          const receipt = await tx.wait();

          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'Swap', {
            poolId,
            tokenIn: dai.address,
            tokenOut: mkr.address,
            amountIn: singleSwap.amount,
            amountOut: singleSwap.amount,
          });
        });

        it('allows performing a join using permit', async () => {
          const joinPoolRequest = {
            assets: [dai.address, ZERO_ADDRESS, mkr.address],
            maxAmountsIn: [100, 0, 100],
            userData: encodeJoin(
              [100, 0, 100],
              tokens.addresses.map(() => 0)
            ),
            fromInternalBalance: false,
          };

          const join = relayer.interface.encodeFunctionData('joinPool', [poolId, signer.address, joinPoolRequest, 0]);

          const tx = await relayer.connect(signer).multicall([daiPermit, mkrPermit, join]);
          const receipt = await tx.wait();

          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'PoolBalanceChanged', {
            poolId,
            liquidityProvider: signer.address,
            tokens: [dai.address, weth.address, mkr.address],
            deltas: [100, 0, 100],
            protocolFeeAmounts: [0, 0, 0],
          });
        });

        it('allows performing a exit', async () => {
          const exitPoolRequest = {
            assets: [dai.address, weth.address, mkr.address],
            minAmountsOut: [100, 100, 100],
            userData: encodeExit(
              tokens.addresses.map(() => 100),
              tokens.addresses.map(() => 0)
            ),
            toInternalBalance: false,
          };

          const exit = relayer.interface.encodeFunctionData('exitPool', [poolId, signer.address, exitPoolRequest]);

          const tx = await relayer.connect(signer).multicall([exit]);
          const receipt = await tx.wait();

          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'PoolBalanceChanged', {
            poolId,
            liquidityProvider: signer.address,
            tokens: [dai.address, weth.address, mkr.address],
            deltas: [-100, -100, -100],
            protocolFeeAmounts: [0, 0, 0],
          });
        });

        context('when sending ETH', () => {
          it('allows performing a join using ETH', async () => {
            const value = 100;

            const joinPoolRequest = {
              assets: [dai.address, ZERO_ADDRESS, mkr.address],
              maxAmountsIn: [0, value, 0],
              userData: encodeJoin(
                [0, value, 0],
                tokens.addresses.map(() => 0)
              ),
              fromInternalBalance: false,
            };

            const join = relayer.interface.encodeFunctionData('joinPool', [
              poolId,
              signer.address,
              joinPoolRequest,
              value,
            ]);

            const userBalanceBefore = await ethers.provider.getBalance(signer.address);

            const tx = await relayer.connect(signer).multicall([join], { value });
            const receipt = await tx.wait();

            const txCost = tx.gasPrice.mul(receipt.gasUsed);
            const expectedBalanceAfter = userBalanceBefore.sub(txCost).sub(value);
            const userBalanceAfter = await ethers.provider.getBalance(signer.address);
            expect(userBalanceAfter).to.be.eq(expectedBalanceAfter);

            // The relayer and vault should have zero balances

            expect(await ethers.provider.getBalance(vault.address)).to.be.eq(0);
            expect(await ethers.provider.getBalance(relayer.address)).to.be.eq(0);

            expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'PoolBalanceChanged', {
              poolId,
              liquidityProvider: signer.address,
              tokens: [dai.address, weth.address, mkr.address],
              deltas: [0, 100, 0],
              protocolFeeAmounts: [0, 0, 0],
            });
          });

          it('refunds the unused ETH', async () => {
            const value = 100;
            const singleSwap = {
              poolId,
              kind: 0,
              assetIn: ZERO_ADDRESS,
              assetOut: mkr.address,
              amount: value,
              userData: '0x',
            };
            const funds = {
              sender: signer.address,
              fromInternalBalance: false,
              recipient: signer.address,
              toInitialBalance: false,
            };

            const swap = relayer.interface.encodeFunctionData('swap', [singleSwap, funds, 1, MAX_UINT256, 20000]);

            const userBalanceBefore = await ethers.provider.getBalance(signer.address);

            const tx = await relayer.connect(signer).multicall([swap], { value: value + 20000 });
            const receipt = await tx.wait();

            const txCost = tx.gasPrice.mul(receipt.gasUsed);
            const expectedBalanceAfter = userBalanceBefore.sub(txCost).sub(value);
            const userBalanceAfter = await ethers.provider.getBalance(signer.address);

            // The relayer and vault should have zero balances
            expect(userBalanceAfter).to.be.eq(expectedBalanceAfter);
            expect(await ethers.provider.getBalance(vault.address)).to.be.eq(0);
            expect(await ethers.provider.getBalance(relayer.address)).to.be.eq(0);
          });
        });
      });

      context('when the first call gives permanent approval', () => {
        let setApproval: string;

        sharedBeforeEach('sign relayer approval', async () => {
          const approval = vault.instance.interface.encodeFunctionData('setRelayerApproval', [
            signer.address,
            relayer.address,
            true,
          ]);
          const signature = await signSetRelayerApprovalAuthorization(vault.instance, signer, relayer, approval);
          const callAuthorisation = encodeCalldataAuthorization('0x', MAX_UINT256, signature);

          setApproval = relayer.interface.encodeFunctionData('setRelayerApproval', [
            relayer.address,
            true,
            callAuthorisation,
          ]);
        });

        it("doesn't require signatures on further calls", async () => {
          const value = 100;

          const joinPoolRequest = {
            assets: [dai.address, ZERO_ADDRESS, mkr.address],
            maxAmountsIn: [0, value, 0],
            userData: encodeJoin(
              [0, value, 0],
              tokens.addresses.map(() => 0)
            ),
            fromInternalBalance: false,
          };

          const join = relayer.interface.encodeFunctionData('joinPool', [
            poolId,
            signer.address,
            joinPoolRequest,
            value,
          ]);

          const tx = await relayer.connect(signer).multicall([setApproval, join], { value });
          const receipt = await tx.wait();

          expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'PoolBalanceChanged', {
            poolId,
            liquidityProvider: signer.address,
            tokens: [dai.address, weth.address, mkr.address],
            deltas: [0, 100, 0],
            protocolFeeAmounts: [0, 0, 0],
          });
        });
      });
    });
  });
});
