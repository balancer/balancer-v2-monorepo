import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { bn, fp } from '../../numbers';
import { DAY, MONTH } from '../../time';
import { toNormalizedWeights } from '@balancer-labs/balancer-js';

import TokenList from '../tokens/TokenList';
import { Account } from './types';
import { RawVaultDeployment, VaultDeployment } from '../vault/types';
import { RawWeightedPoolDeployment, WeightedPoolDeployment } from '../pools/weighted/types';
import { RawStablePoolDeployment, StablePoolDeployment } from '../pools/stable/types';
import {
  RawTokenApproval,
  RawTokenMint,
  RawTokensDeployment,
  TokenApproval,
  TokenMint,
  TokenDeployment,
  RawTokenDeployment,
} from '../tokens/types';
import { ZERO_ADDRESS } from '../../constants';

export default {
  toVaultDeployment(params: RawVaultDeployment): VaultDeployment {
    let { mocked, admin, pauseWindowDuration, bufferPeriodDuration } = params;
    if (!mocked) mocked = false;
    if (!admin) admin = params.from;
    if (!pauseWindowDuration) pauseWindowDuration = 0;
    if (!bufferPeriodDuration) bufferPeriodDuration = 0;
    return { mocked, admin, pauseWindowDuration, bufferPeriodDuration };
  },

  toRawVaultDeployment(params: RawWeightedPoolDeployment | RawStablePoolDeployment): RawVaultDeployment {
    let { admin, pauseWindowDuration, bufferPeriodDuration } = params;
    if (!admin) admin = params.from;
    if (!pauseWindowDuration) pauseWindowDuration = 0;
    if (!bufferPeriodDuration) bufferPeriodDuration = 0;

    const mocked = params.fromFactory !== undefined ? !params.fromFactory : true;
    return { mocked, admin, pauseWindowDuration, bufferPeriodDuration };
  },

  toWeightedPoolDeployment(params: RawWeightedPoolDeployment): WeightedPoolDeployment {
    let {
      tokens,
      weights,
      assetManagers,
      swapFeePercentage,
      pauseWindowDuration,
      bufferPeriodDuration,
      oracleEnabled,
      swapEnabledOnStart,
      twoTokens,
      lbp,
    } = params;
    if (!tokens) tokens = new TokenList();
    if (!weights) weights = Array(tokens.length).fill(fp(1));
    weights = toNormalizedWeights(weights.map(bn));
    if (!swapFeePercentage) swapFeePercentage = bn(1e16);
    if (!pauseWindowDuration) pauseWindowDuration = 3 * MONTH;
    if (!bufferPeriodDuration) bufferPeriodDuration = MONTH;
    if (!oracleEnabled) oracleEnabled = true;
    if (!assetManagers) assetManagers = Array(tokens.length).fill(ZERO_ADDRESS);
    if (!lbp) lbp = false;
    if (undefined == swapEnabledOnStart) swapEnabledOnStart = true;
    if (!twoTokens) twoTokens = false;
    else if (tokens.length !== 2) throw Error('Cannot request custom 2-token pool without 2 tokens in the list');
    return {
      tokens,
      weights,
      assetManagers,
      swapFeePercentage,
      pauseWindowDuration,
      bufferPeriodDuration,
      oracleEnabled,
      swapEnabledOnStart,
      owner: params.owner,
      twoTokens,
      lbp,
    };
  },

  toStablePoolDeployment(params: RawStablePoolDeployment): StablePoolDeployment {
    let {
      tokens,
      rateProviders,
      priceRateCacheDuration,
      amplificationParameter,
      swapFeePercentage,
      pauseWindowDuration,
      bufferPeriodDuration,
      oracleEnabled,
      meta,
    } = params;

    if (!tokens) tokens = new TokenList();
    if (!rateProviders) rateProviders = Array(tokens.length).fill(ZERO_ADDRESS);
    if (!priceRateCacheDuration) priceRateCacheDuration = Array(tokens.length).fill(DAY);
    if (!amplificationParameter) amplificationParameter = bn(200);
    if (!swapFeePercentage) swapFeePercentage = bn(0);
    if (!pauseWindowDuration) pauseWindowDuration = 3 * MONTH;
    if (!bufferPeriodDuration) bufferPeriodDuration = MONTH;
    if (!oracleEnabled) oracleEnabled = true;
    if (!meta) meta = false;

    return {
      tokens,
      rateProviders,
      priceRateCacheDuration,
      amplificationParameter,
      swapFeePercentage,
      pauseWindowDuration,
      bufferPeriodDuration,
      oracleEnabled,
      meta,
      owner: params.owner,
    };
  },

  /***
   * Converts a raw list of token deployments into a consistent deployment request
   * @param params It can be a number specifying the number of tokens to be deployed, a list of strings denoting the
   * token symbols to be used, or a list of token attributes (decimals, symbol, name).
   * @param from A default signer can be specified as the deployer address of the entire list, otherwise a single
   * signer per token can be defined.
   */
  toTokenDeployments(params: RawTokensDeployment, from?: SignerWithAddress, varyDecimals = false): TokenDeployment[] {
    params = typeof params === 'number' ? Array(params).fill({}) : params;
    if (!Array.isArray(params)) params = [params];

    return params.map((param, i) => {
      if (typeof param === 'string') param = { symbol: param, from };
      const args = Object.assign(
        {},
        { symbol: `TK${i}`, name: `Token ${i}`, decimals: varyDecimals ? Math.max(18 - i, 0) : 18, from },
        param
      );
      return this.toTokenDeployment(args);
    });
  },

  /***
   * Converts a raw token deployment into a consistent deployment request
   * @param params Could be a single string denoting the token symbol or optional token attributes (decimals, symbol, name)
   */
  toTokenDeployment(params: RawTokenDeployment): TokenDeployment {
    if (typeof params === 'string') params = { symbol: params };
    const { name, symbol, decimals, from } = params;
    return {
      from,
      name: name ?? `Token`,
      symbol: symbol ?? `TKN`,
      decimals: decimals ?? 18,
    };
  },

  /***
   * Converts a raw token mint param into a consistent minting list
   */
  toTokenMints(params: RawTokenMint): TokenMint[] {
    if (Array.isArray(params)) return params.flatMap(this.toTokenMints);

    const { to, amount, from } = params;

    if (!Array.isArray(to)) {
      if (Array.isArray(from)) throw Error('Inconsistent mint sender length');
      return [{ to, amount, from }];
    }

    if (Array.isArray(from) && to.length !== from.length) throw Error('Inconsistent mint sender length');
    return to.map((to, i) => ({ to, amount, from: Array.isArray(from) ? from[i] : from }));
  },

  /***
   * Converts a raw token approval param into a consistent approval list
   */
  toTokenApprovals(params: RawTokenApproval): TokenApproval[] {
    if (Array.isArray(params)) return params.flatMap(this.toTokenApprovals);

    const { to: recipients, amount, from } = params;
    const to = Array.isArray(recipients) ? recipients : [recipients];

    return to.flatMap((to) =>
      Array.isArray(from) ? from.map((from) => ({ to, amount, from })) : [{ to, amount, from }]
    );
  },

  toAddress(to?: Account): string {
    if (!to) return ZERO_ADDRESS;
    return typeof to === 'string' ? to : to.address;
  },
};
