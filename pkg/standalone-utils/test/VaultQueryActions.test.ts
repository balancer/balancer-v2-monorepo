import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { SwapKind } from '@balancer-labs/balancer-js';
import { randomAddress } from '@balancer-labs/v2-helpers/src/constants';
import { Contract } from 'ethers';
import { expect } from 'chai';
import { expectChainedReferenceContents, toChainedReference } from './helpers/chainedReferences';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import { setupRelayerEnvironment, encodeSwap, approveVaultForRelayer } from './VaultActionsRelayer.setup';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';

describe('VaultQueryActions', function () {
  let queries: Contract;
  let vault: Vault;
  let tokens: TokenList;
  let relayer: Contract, relayerLibrary: Contract;
  let user: SignerWithAddress, other: SignerWithAddress;

  let poolIdA: string;
  let tokensA: TokenList;

  let recipient: Account;

  before('setup environment', async () => {
    ({ user, other, vault, relayer, relayerLibrary } = await setupRelayerEnvironment());
    queries = await deploy('BalancerQueries', { args: [vault.address] });
  });

  before('setup common recipient', () => {
    // All the tests use the same recipient; this is a simple abstraction to improve readability.
    recipient = randomAddress();
  });

  sharedBeforeEach('set up pools', async () => {
    tokens = (await TokenList.create(['DAI', 'MKR', 'SNX', 'BAT'])).sort();
    await tokens.mint({ to: user });
    await tokens.approve({ to: vault, from: user });

    // Pool A: DAI-MKR
    tokensA = new TokenList([tokens.DAI, tokens.MKR]).sort();
    const poolA = await WeightedPool.create({
      tokens: tokensA,
      vault,
    });
    await poolA.init({ initialBalances: fp(1000), from: user });

    poolIdA = await poolA.getPoolId();
  });

  describe('simple swap', () => {
    const amountIn = fp(2);

    context('when caller is not authorized', () => {
      it('reverts', async () => {
        expect(
          relayer.connect(other).queryMulticall([
            encodeSwap(relayerLibrary, {
              poolId: poolIdA,
              tokenIn: tokens.DAI,
              tokenOut: tokens.MKR,
              amount: amountIn,
              sender: user.address,
              recipient,
            }),
          ])
        ).to.be.revertedWith('Incorrect sender');
      });
    });

    context('when caller is authorized', () => {
      let sender: Account;

      context('sender = user', () => {
        beforeEach(() => {
          sender = user;
        });

        itTestsSimpleSwap();
      });

      context('sender = relayer', () => {
        sharedBeforeEach('fund relayer with tokens and approve vault', async () => {
          sender = relayer;
          await tokens.DAI.transfer(relayer, amountIn, { from: user });
          await approveVaultForRelayer(relayerLibrary, user, tokens);
        });

        itTestsSimpleSwap();
      });

      function itTestsSimpleSwap() {
        it('stores swap output as chained reference', async () => {
          const expectedAmountOut = await queries.querySwap(
            {
              poolId: poolIdA,
              kind: SwapKind.GivenIn,
              assetIn: tokens.DAI.address,
              assetOut: tokens.MKR.address,
              amount: amountIn,
              userData: '0x',
            },
            {
              sender: TypesConverter.toAddress(sender),
              recipient: TypesConverter.toAddress(recipient),
              fromInternalBalance: false,
              toInternalBalance: false,
            }
          );

          await (
            await relayer.connect(user).multicall([
              encodeSwap(relayerLibrary, {
                poolId: poolIdA,
                tokenIn: tokens.DAI,
                tokenOut: tokens.MKR,
                amount: amountIn,
                outputReference: toChainedReference(0),
                sender,
                recipient,
              }),
            ])
          ).wait();

          await expectChainedReferenceContents(relayer, toChainedReference(0), expectedAmountOut);
        });
      }
    });
  });
});
