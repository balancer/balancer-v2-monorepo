import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { SwapKind } from '@balancer-labs/balancer-js';
import { BigNumberish, fp, bn } from '@balancer-labs/v2-helpers/src/numbers';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { RawStablePoolDeployment } from '@balancer-labs/v2-helpers/src/models/pools/stable/types';
import { currentTimestamp, DAY } from '@balancer-labs/v2-helpers/src/time';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import StablePhantomPool from '@balancer-labs/v2-helpers/src/models/pools/stable/StablePool';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';

describe('ComposableStablePool with non-18 decimal tokens', () => {
  // Use non-round numbers
  const SWAP_FEE_PERCENTAGE = fp(0.0234);
  const PROTOCOL_SWAP_FEE_PERCENTAGE = fp(0.34);
  const AMPLIFICATION_PARAMETER = bn(200);

  let tokens: TokenList;
  let pool: StablePhantomPool;
  let bptIndex: number;
  let initialBalances: BigNumberish[];
  let scalingFactors: BigNumber[];
  let tokenRates: BigNumber[];
  let protocolFeesCollector: Contract;
  let previousFeeBalance: BigNumber;
  let recipient: SignerWithAddress;
  let owner: SignerWithAddress;
  let admin: SignerWithAddress;

  const rateProviders: Contract[] = [];
  const tokenRateCacheDurations: BigNumberish[] = [];
  const exemptFromYieldProtocolFeeFlags: boolean[] = [];

  sharedBeforeEach('setup signers', async () => {
    [, owner, recipient, admin] = await ethers.getSigners();
  });

  // Used a fixed 5-token pool with all non-18 decimal tokens, including extreme values (0, 17),
  // and common non-18 values (6, 8).
  sharedBeforeEach('deploy tokens', async () => {
    // Ensure we cover the full range, from 0 to 17
    // Including common non-18 values of 6 and 8
    tokens = await TokenList.create([
      { decimals: 17, symbol: 'TK17' },
      { decimals: 11, symbol: 'TK11' },
      { decimals: 8, symbol: 'TK8' },
      { decimals: 6, symbol: 'TK6' },
      { decimals: 0, symbol: 'TK0' },
    ]);
    // NOTE: must sort after creation!
    // TokenList.create with the sort option will strip off the decimals
    tokens = tokens.sort();
    tokenRates = Array.from({ length: tokens.length }, (_, i) => fp(1 + (i + 1) / 10));

    // Balances are all "100" to the Vault
    initialBalances = Array(tokens.length + 1).fill(fp(100));
    // Except the BPT token, which is 0
    initialBalances[bptIndex] = fp(0);
  });

  function _skipBptIndex(bptIndex: number, index: number): number {
    return index < bptIndex ? index : index - 1;
  }

  function _dropBptItem(bptIndex: number, items: BigNumberish[]): BigNumberish[] {
    const result = [];
    for (let i = 0; i < items.length - 1; i++) result[i] = items[i < bptIndex ? i : i + 1];
    return result;
  }

  async function deployPool(
    params: RawStablePoolDeployment = {},
    rates: BigNumberish[] = [],
    protocolSwapFeePercentage: BigNumber
  ): Promise<void> {
    // 0th token has no rate provider, to test that case
    const rateProviderAddresses: Account[] = Array(tokens.length).fill(ZERO_ADDRESS);
    tokenRateCacheDurations[0] = 0;
    exemptFromYieldProtocolFeeFlags[0] = false;

    for (let i = 1; i < tokens.length; i++) {
      rateProviders[i] = await deploy('v2-pool-utils/MockRateProvider');
      rateProviderAddresses[i] = rateProviders[i].address;

      await rateProviders[i].mockRate(rates[i] || fp(1));
      tokenRateCacheDurations[i] = params.tokenRateCacheDurations ? params.tokenRateCacheDurations[i] : 0;
      exemptFromYieldProtocolFeeFlags[i] = params.exemptFromYieldProtocolFeeFlags
        ? params.exemptFromYieldProtocolFeeFlags[i]
        : false;
    }

    pool = await StablePhantomPool.create({
      tokens,
      rateProviders: rateProviderAddresses,
      tokenRateCacheDurations,
      exemptFromYieldProtocolFeeFlags,
      owner,
      admin,
      ...params,
    });

    bptIndex = await pool.getBptIndex();
    scalingFactors = await pool.getScalingFactors();

    await pool.vault.setSwapFeePercentage(protocolSwapFeePercentage);
    await pool.updateProtocolFeePercentageCache();
    protocolFeesCollector = await pool.vault.getFeesCollector();
    previousFeeBalance = await pool.balanceOf(protocolFeesCollector.address);
  }

  async function initializePool(): Promise<void> {
    // This is the unscaled input for the balances. For instance, "100" is "100" for 0 decimals, and "100000000" for 6 decimals
    const unscaledBalances = await pool.downscale(initialBalances);

    for (let i = 0; i < initialBalances.length; i++) {
      if (i != bptIndex) {
        const token = tokens.get(_skipBptIndex(bptIndex, i));
        await token.instance.mint(recipient.address, unscaledBalances[i]);
      }
    }
    await tokens.approve({ from: recipient, to: pool.vault });
    await pool.init({ recipient, initialBalances: unscaledBalances });
  }

  context('with unary rates', () => {
    sharedBeforeEach('initialize pool', async () => {
      // Set rates to 1 to test decimal scaling independently
      const unaryRates = Array(tokens.length).fill(fp(1));

      await deployPool(
        { swapFeePercentage: SWAP_FEE_PERCENTAGE, amplificationParameter: AMPLIFICATION_PARAMETER },
        unaryRates,
        PROTOCOL_SWAP_FEE_PERCENTAGE
      );

      await initializePool();
    });

    it('sets scaling factors', async () => {
      const tokenScalingFactors: BigNumber[] = [];

      for (let i = 0; i < tokens.length + 1; i++) {
        if (i == bptIndex) {
          tokenScalingFactors[i] = fp(1);
        } else {
          const j = _skipBptIndex(bptIndex, i);
          tokenScalingFactors[i] = fp(10 ** (18 - tokens.get(j).decimals));
        }
      }

      expect(tokenScalingFactors).to.deep.equal(scalingFactors);
    });

    it('initializes with uniform initial balances', async () => {
      const balances = await pool.getBalances();
      // Upscaling the result will recover the initial balances: all fp(100)
      const upscaledBalances = await pool.upscale(balances);

      expect(_dropBptItem(bptIndex, upscaledBalances)).to.deep.equal(_dropBptItem(bptIndex, initialBalances));
    });

    it('grants the invariant amount of BPT', async () => {
      const balances = await pool.getBalances();
      const invariant = await pool.estimateInvariant(await pool.upscale(balances));

      // Initial balances should equal invariant
      expect(await pool.balanceOf(recipient)).to.be.equalWithError(invariant, 0.001);
    });
  });

  /**
   * The intent here is to test every path through the code, ensuring decimal scaling and rate scaling are
   * correctly employed in each case, and the protocol fees collected match expectations.
   */
  describe('protocol fees, scaling, and rates', () => {
    const tokenNoRateIndex = 0;
    const tokenWithRateIndex = 1;
    const tokenWithRateExemptIndex = 2; // exempt flags are set for "even" indices (2 and 4)

    sharedBeforeEach('initialize pool', async () => {
      // Set indices 2 and 4 to be exempt (even)
      const exemptFlags = [false, false, true, false, true];

      await deployPool(
        {
          swapFeePercentage: SWAP_FEE_PERCENTAGE,
          amplificationParameter: AMPLIFICATION_PARAMETER,
          exemptFromYieldProtocolFeeFlags: exemptFlags,
        },
        tokenRates,
        PROTOCOL_SWAP_FEE_PERCENTAGE
      );

      await initializePool();
    });

    // Do a bunch of regular swaps to incur fees / change the invariant
    async function incurProtocolFees(): Promise<void> {
      // This should change the balance of all tokens (at least the 3 being used below)
    }

    /**
     * A swap could be:
     * 1) regular swap, given in or out, between two non-BPT tokens
     * 2) a BPT swap, given in or out: one of the tokens is the BPT token
     *
     * Regular swaps have no interaction with the protocol fee system, but they change balances,
     * causing the invariant to increase.
     *
     * BPT swaps are joins or exits, so they trigger payment of protocol fees
     * (and updating the cache needed for the next join/exit)
     */
    describe('swaps', () => {
      /**
       * 1) StablePhantomPool.onSwap:
       *    update rates, if necessary (can set the duration to 0 so it will always update them)
       *    This is done to ensure we are *always* using the latest rates for operations (e.g.,
       *    if swaps are infrequent and we didn't do this, the rate could be very stale)
       * 2) BaseGeneralPool.onSwap:
       *    compute scaling factors, which includes both token decimals and rates
       *    determine GivenIn vs. GivenOut
       *        StablePhantomPool._swapGivenIn:
       *            Determine it is a regular swap
       *            BaseGeneralPool._swapGivenIn:
       *                Subtract swap fee from amountIn
       *                Apply scaling to balances and amounts
       *                Call StablePhantomPool._onSwapGivenIn to compute amountOut: see #3
       *                Downscale amountOut and return to Vault
       *        StablePhantomPool._swapGivenOut:
       *            Determine it is a regular swap
       *            BaseGeneralPool._swapGivenOut:
       *                Apply scaling to balances and amounts
       *                Call StablePhantomPool._onSwapGivenOut to compute amountIn: see #3
       *                Add swap fee to amountIn
       *                Downscale amountIn and return to Vault
       * 3) StablePhantomPool._onSwapGivenIn/Out:
       *        StablePhantomPool._onRegularSwap:
       *            Call StableMath with scaled balances and current amp to compute amountIn/Out
       */
      context('regular swaps', () => {
        // Swap 10% of the value
        let unscaledAmounts: BigNumberish[];

        sharedBeforeEach('calculate swap amounts', async () => {
          // These will be the "downscaled" raw input swap amounts
          const scaledSwapAmounts = Array(tokens.length).fill(fp(10));
          unscaledAmounts = await pool.downscale(scaledSwapAmounts);
          expect(previousFeeBalance).to.be.zero;
        });

        function itPerformsARegularSwap(kind: SwapKind, indexIn: number, indexOut: number) {
          it('performs a regular swap', async () => {
            // const amount = kind == SwapKind.GivenIn ? unscaledAmounts[indexIn] : unscaledAmounts[indexOut];
            const rateFactor = fp(1.1);
            let oldRate: BigNumber;

            console.log(`unscaled amounts: ${unscaledAmounts}`);
            // predict results
            // do swap
            // validate results

            // Change rates between GivenIn and GivenOut
            if (kind == SwapKind.GivenIn) {
              // Change rate (remember 0 has no provider)
              if (indexIn > 0) {
                oldRate = await rateProviders[indexIn].getRate();
                await rateProviders[indexIn].mockRate(
                  Math.random() > 0.5 ? oldRate.mul(rateFactor) : oldRate.div(rateFactor)
                );
              }
              oldRate = await rateProviders[indexOut].getRate();
              await rateProviders[indexOut].mockRate(
                Math.random() > 0.5 ? oldRate.mul(rateFactor) : oldRate.div(rateFactor)
              );
            }
          });
        }

        // Swap each token with the next (don't need all permutations), both GivenIn and GivenOut, changing
        // rates in between. i < tokens.length - 1; tokens isn't defined outside an it
        for (let i = 0; i < 4; i++) {
          itPerformsARegularSwap(SwapKind.GivenIn, i, i + 1);
          // The GivenIn swap changes the rate
          itPerformsARegularSwap(SwapKind.GivenOut, i, i + 1);
        }
      });

      /**
       * 1) StablePhantomPool.onSwap:
       *    update rates, if necessary (can set the duration to 0 so it will always update them)
       *    This is done to ensure we are *always* using the latest rates for operations (e.g.,
       *    if swaps are infrequent and we didn't do this, the rate could be very stale)
       * 2) BaseGeneralPool.onSwap:
       *    compute scaling factors, which includes both token decimals and rates
       *    determine GivenIn vs. GivenOut
       *        StablePhantomPool._swapGivenIn:
       *            Determine it is a BPT swap
       *            StablePhantomPool._swapWithBpt:
       *                Apply scaling factors to balances
       *                Pay protocol fees (based on invariant growth)
       *                Call StablePhantomPool._onSwapBptGivenIn to compute amountOut; see #3
       *                Downscale amountOut and return to Vault
       *        StablePhantomPool._swapGivenOut:
       *            Determine it is a BPT swap
       *            StablePhantomPool._swapWithBpt:
       *                Apply scaling factors to balances
       *                Pay protocol fees (based on invariant growth)
       *                Call StablePhantomPool._onSwapBptGivenOut to compute amountIn; see #3
       *                Downscale amountIn and return to Vault
       * 3) StablePhantomPool._onSwapBptGivenIn:
       *        If tokenIn is BPT: (exitSwap)
       *            Calculate amountOut with _calcTokenOutGivenExactBptIn; subtract amountOut from balances
       *        else: (joinSwap)
       *            Calculate BPTOut with _calcBptOutGivenExactTokensIn; add amountIn to balances
       *    StablePhantomPool._onSwapBptGivenOut:
       *        If tokenIn is BPT: (joinSwap)
       *            Calculate BPTIn with _calcBptInGivenExactTokensOut; subtract amountsOut from balances
       *       else: (exitSwap)
       *           Calculate amountIn with _calcTokenInGivenExactBptOut; add amountsIn to balances
       * 4) StablePhantomPool._updateInvariantAfterJoinExit:
       *        Using the post-swap balances calculated above
       *        _postJoinExitAmp = current amp
       *        _postJoinExitInvariant = calculate invariant using the current amp and post-swap balances
       *        Set oldRate = currentRate for any exempt tokens
       */
      context('BPT swaps', () => {
        // The cached amp and postJoinExit invariant will already be set from the pool initialization
        // So we want to test:
        // 1) If the first thing we do is a join or exit swap, there should be no protocol fees
        // 2) The amp and invariant should be set to the current values
        // 3) We should test both GivenIn and GivenOut, with the "other" token being 0 (no rate provider), and 1 (with rate provider)
        const NEW_AMP = AMPLIFICATION_PARAMETER.mul(3);
        const rateFactor = fp(1.1);
        let oldRate: BigNumber;

        sharedBeforeEach('start an amp change', async () => {
          const startTime = await currentTimestamp();
          const endTime = startTime.add(DAY * 2);

          await pool.startAmpChange(NEW_AMP, endTime);
        });

        function itPerformsABptSwapOnly(kind: SwapKind, tokenIndex: number) {
          it('performs a BPT swap as the first operation', async () => {
            // Advance time so that amp changes (should be reflected in postJoinExit invariant, which should be different from invariant before the operation)
            if (tokenIndex != tokenNoRateIndex) {
              // Change the rate before the operation
              oldRate = await rateProviders[tokenIndex].getRate();
              await rateProviders[tokenIndex].mockRate(
                Math.random() > 0.5 ? oldRate.mul(rateFactor) : oldRate.div(rateFactor)
              );
            }
            // Do the swap, with the request set to BPT + token with the given index
            // Zero protocol fees, postJoinExits set properly
          });
        }

        function itPerformsABptSwapWithInterveningSwaps(kind: SwapKind, tokenIndex: number) {
          it('performs a BPT swap with intervening swaps', async () => {
            let oldRate: BigNumber;
            let newRate: BigNumber;

            // incur protocol fees - this changes the balances and ensures a different invariant
            // Advance time so that the amp changes
            if (tokenIndex != tokenNoRateIndex) {
              // Change the rate before the operation; may need the old one for fee calculation
              oldRate = await rateProviders[tokenIndex].getRate();
              newRate = Math.random() > 0.5 ? oldRate.mul(rateFactor) : oldRate.div(rateFactor);

              await rateProviders[tokenIndex].mockRate(newRate);
            }
            // Do the swap, with the request set to BPT + token with the given index
            // Protocol fees (using old rate and old amp, if exempt, or old amp and new rate otherwise)
            // postJoinExits set properly (current amp)
            // Verify that old rates are updated after the operation
          });
        }

        for (const kind of [SwapKind.GivenIn, SwapKind.GivenOut]) {
          for (const tokenIndex of [tokenNoRateIndex, tokenWithRateIndex, tokenWithRateExemptIndex]) {
            itPerformsABptSwapOnly(kind, tokenIndex);
          }
          for (const tokenIndex of [tokenNoRateIndex, tokenWithRateIndex, tokenWithRateExemptIndex]) {
            itPerformsABptSwapWithInterveningSwaps(kind, tokenIndex);
          }
        }
      });
    });

    /**
     * A join can be single token or "exact tokens in," either of which trigger protocol fee collection and caching.
     * A proportional join should pay no protocol fees.
     *
     * 1) StablePhantomPool.onJoinPool:
     *     update rates, if necessary (can set the duration to 0 so it will always update them)
     *     BasePool.onJoinPool:
     *         compute scaling factors, which includes both token decimals and rates
     *         Apply scaling factors to balances
     *         Call StablePhantomPool._onJoinPool to compute BPT amountOut and amountsIn; see #2
     *         mint BPTOut to recipient
     *         downscale and return amountsIn to the Vault
     * 2) StablePhantomPool._onJoinPool:
     *        Pay protocol fees (based on invariant growth)
     *        Check for one-token or multi-token:
     *        If multi-token, StablePhantomPool._joinExactTokensInForBPTOut:
     *            Apply scaling factors to amounts in (decimals and rates)
     *            Call _calcBptOutGivenExactTokensIn to compute BPT Out, and check limits passed in from caller
     *            Add amountsIn to compute post-join balances
     *        If one-token, StablePhantomPool._joinTokenInForExactBPTOut:
     *            Call _calcTokenInGivenExactBptOut to compute the amountIn
     *            Add amountsIn to compute post-join balances
     * 3) StablePhantomPool._updateInvariantAfterJoinExit:
     *        Using the post-join balances calculated above
     *        _postJoinExitAmp = current amp
     *        _postJoinExitInvariant = calculate invariant using the current amp and post-swap balances
     *        Set oldRate = currentRate for any exempt tokens
     */
    describe('joins', () => {
      const NEW_AMP = AMPLIFICATION_PARAMETER.mul(3);
      const rateFactor = fp(1.1);

      let scaledSwapAmounts: BigNumber[];
      let unscaledAmounts: BigNumberish[];
      const oldRates: BigNumber[] = [];
      const newRates: BigNumber[] = [];

      sharedBeforeEach('start an amp change', async () => {
        const startTime = await currentTimestamp();
        const endTime = startTime.add(DAY * 2);

        await pool.startAmpChange(NEW_AMP, endTime);
      });

      sharedBeforeEach('calculate join amounts', async () => {
        // These will be the "downscaled" raw input swap amounts
        scaledSwapAmounts = Array(tokens.length).fill(fp(10));
        unscaledAmounts = await pool.downscale(scaledSwapAmounts);
        console.log(`unscaled amounts: ${unscaledAmounts}`);
      });

      function itPerformsASingleTokenJoin(tokenIndex: number) {
        it(`calculates fees for single token joins with index ${tokenIndex}`, async () => {
          // Process a bunch of swaps (amp will also change during these)
          await incurProtocolFees();

          // Change all the rates (recall that 0 has no provider)
          oldRates[0] = fp(1);
          newRates[0] = fp(1);
          for (let i = 1; i < tokens.length; i++) {
            // Change the rate before the operation; may need the old one for fee calculation
            oldRates[i] = await rateProviders[i].getRate();
            newRates[i] = Math.random() > 0.5 ? oldRates[i].mul(rateFactor) : oldRates[i].div(rateFactor);

            await rateProviders[i].mockRate(newRates[i]);
          }

          // Do single token join with the given index
          // Check protocol fees (using oldRates/newRates, etc.)
          // Check updated amp/invariant values, and that oldRates have been updated
        });
      }

      for (const tokenIndex of [tokenNoRateIndex, tokenWithRateIndex, tokenWithRateExemptIndex]) {
        itPerformsASingleTokenJoin(tokenIndex);
      }

      function itPerformsAMultiTokenJoin(amountInRatios: number[]) {
        it('calculates fees for multi-token joins', async () => {
          console.log(`ratios: ${amountInRatios}`);
          // const amountsIn = scaledSwapAmounts.map((a, i) => a.mul(fp(amountInRatios[i])));
          // Do multi token join with the given amountsIn
          // Check protocol fees (using oldRates/newRates, etc.)
          // Check updated amp/invariant values, and that oldRates have been updated
        });
      }

      const unbalancedJoin = [0.8, 1.2, 2, 0.05, 0.45];
      const proportionalJoin = Array(5).fill(1);

      itPerformsAMultiTokenJoin(unbalancedJoin);
      // Should have no fees
      itPerformsAMultiTokenJoin(proportionalJoin);
    });

    /**
     * An exit can be single token or "exact tokens out," either of which trigger protocol fee collection and caching.
     * A proportional exit should pay no protocol fees.
     *
     * 1) StablePhantomPool.onExitPool:
     *     update rates, if necessary (can set the duration to 0 so it will always update them)
     *     BasePool.onExitPool:
     *         Check for recovery mode exit - if so, do that one instead
     *         compute scaling factors, which includes both token decimals and rates
     *         Apply scaling factors to balances
     *         Call StablePhantomPool._onExitPool to compute BPT amountIn and amountsOut; see #2
     *         burn BPTIn from sender
     *         downscale and return amountsOut to the Vault
     * 2) StablePhantomPool._onExitPool:
     *        Pay protocol fees (based on invariant growth)
     *        Check for one-token or multi-token:
     *        If multi-token, StablePhantomPool._exitBPTInForExactTokensOut:
     *            Apply scaling factors to amounts out (decimals and rates)
     *            Call _calcBptInGivenExactTokensOut to compute BPT In, and check limits passed in from caller
     *            Subtract amountsOut to compute post-exit balances
     *        If one-token, StablePhantomPool._exitExactBPTInForTokenOut:
     *            Call _calcTokenOutGivenExactBptIn to compute the amountOut
     *            Subtract amountsOut to compute post-exit balances
     * 3) StablePhantomPool._updateInvariantAfterJoinExit:
     *        Using the post-join balances calculated above
     *        _postJoinExitAmp = current amp
     *        _postJoinExitInvariant = calculate invariant using the current amp and post-swap balances
     *        Set oldRate = currentRate for any exempt tokens
     */
    describe('exits', () => {
      const NEW_AMP = AMPLIFICATION_PARAMETER.mul(3);
      const rateFactor = fp(1.1);

      let scaledSwapAmounts: BigNumber[];
      let unscaledAmounts: BigNumberish[];
      const oldRates: BigNumber[] = [];
      const newRates: BigNumber[] = [];

      sharedBeforeEach('start an amp change', async () => {
        const startTime = await currentTimestamp();
        const endTime = startTime.add(DAY * 2);

        await pool.startAmpChange(NEW_AMP, endTime);
      });

      sharedBeforeEach('calculate exit amounts', async () => {
        // These will be the "downscaled" raw input swap amounts
        scaledSwapAmounts = Array(tokens.length).fill(fp(10));
        unscaledAmounts = await pool.downscale(scaledSwapAmounts);
        console.log(`unscaled amounts: ${unscaledAmounts}`);
      });

      function itPerformsASingleTokenExit(tokenIndex: number) {
        it(`calculates fees for single token exits with token index ${tokenIndex}`, async () => {
          // Process a bunch of swaps (amp will also change during these)
          await incurProtocolFees();

          // Change all the rates (recall that 0 has no provider)
          oldRates[0] = fp(1);
          newRates[0] = fp(1);
          for (let i = 1; i < tokens.length; i++) {
            // Change the rate before the operation; may need the old one for fee calculation
            oldRates[i] = await rateProviders[i].getRate();
            newRates[i] = Math.random() > 0.5 ? oldRates[i].mul(rateFactor) : oldRates[i].div(rateFactor);

            await rateProviders[i].mockRate(newRates[i]);
          }

          // Do single token join with the given index
          // Check protocol fees (using oldRates/newRates, etc.)
          // Check updated amp/invariant values, and that oldRates have been updated
        });
      }

      for (const tokenIndex of [tokenNoRateIndex, tokenWithRateIndex, tokenWithRateExemptIndex]) {
        itPerformsASingleTokenExit(tokenIndex);
      }

      function itPerformsAMultiTokenExit(amountOutRatios: number[]) {
        it('calculates fees for multi-token joins', async () => {
          console.log(`amountOutRatios: ${amountOutRatios}`);
          // const amountsOut = scaledSwapAmounts.map((a, i) => a.mul(fp(amountOutRatios[i])));
          // Do multi token exit with the given amountsOut
          // Check protocol fees (using oldRates/newRates, etc.)
          // Check updated amp/invariant values, and that oldRates have been updated
        });
      }

      const unbalancedExit = [0.62, 1.08, 1.88, 0.25, 0.78];
      const proportionalExit = Array(5).fill(1);

      itPerformsAMultiTokenExit(unbalancedExit);
      // Should have no fees
      itPerformsAMultiTokenExit(proportionalExit);
    });
  });
});
