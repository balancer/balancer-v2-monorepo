import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { MONTH } from '@balancer-labs/v2-helpers/src/time';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { toNormalizedWeights } from '@balancer-labs/v2-helpers/src/weights';

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

export default {
  toVaultDeployment(params: RawVaultDeployment): VaultDeployment {
    let { mocked, admin, emergencyPeriod, emergencyPeriodCheckExtension } = params;
    if (!mocked) mocked = false;
    if (!admin) admin = params.from;
    if (!emergencyPeriod) emergencyPeriod = 0;
    if (!emergencyPeriodCheckExtension) emergencyPeriodCheckExtension = 0;
    return { mocked, admin, emergencyPeriod, emergencyPeriodCheckExtension };
  },

  toRawVaultDeployment(params: RawWeightedPoolDeployment): RawVaultDeployment {
    let { admin, emergencyPeriod, emergencyPeriodCheckExtension } = params;
    if (!admin) admin = params.from;
    if (!emergencyPeriod) emergencyPeriod = 0;
    if (!emergencyPeriodCheckExtension) emergencyPeriodCheckExtension = 0;

    const mocked = params.fromFactory !== undefined ? !params.fromFactory : true;
    return { mocked, admin, emergencyPeriod, emergencyPeriodCheckExtension };
  },

  toWeightedPoolDeployment(params: RawWeightedPoolDeployment): WeightedPoolDeployment {
    let { tokens, weights, swapFee, emergencyPeriod, emergencyPeriodCheckExtension } = params;
    if (!tokens) tokens = new TokenList();
    if (!weights) weights = Array(tokens.length).fill(fp(1));
    weights = toNormalizedWeights(weights.map(bn));
    if (!swapFee) swapFee = bn(0);
    if (!emergencyPeriod) emergencyPeriod = 3 * MONTH;
    if (!emergencyPeriodCheckExtension) emergencyPeriodCheckExtension = MONTH;
    return { tokens, weights, swapFee, emergencyPeriod, emergencyPeriodCheckExtension };
  },

  toStablePoolDeployment(params: RawStablePoolDeployment): StablePoolDeployment {
    let { tokens, amplificationParameter, swapFee, emergencyPeriod, emergencyPeriodCheckExtension } = params;
    if (!tokens) tokens = new TokenList();
    if (!amplificationParameter) amplificationParameter = bn(200 * 1e18);
    if (!swapFee) swapFee = bn(0);
    if (!emergencyPeriod) emergencyPeriod = 3 * MONTH;
    if (!emergencyPeriodCheckExtension) emergencyPeriodCheckExtension = MONTH;
    return { tokens, amplificationParameter, swapFee, emergencyPeriod, emergencyPeriodCheckExtension };
  },

  /***
   * Converts a raw list of token deployments into a consistent deployment request
   * @param params It can be a number specifying the number of tokens to be deployed, a list of strings denoting the
   * token symbols to be used, or a list of token attributes (decimals, symbol, name).
   * @param from A default signer can be specified as the deployer address of the entire list, otherwise a single
   * signer per token can be defined.
   */
  toTokenDeployments(params: RawTokensDeployment, from?: SignerWithAddress): TokenDeployment[] {
    params = typeof params === 'number' ? Array(params).fill({}) : params;
    if (!Array.isArray(params)) params = [params];

    return params.map((param, i) => {
      if (typeof param === 'string') param = { symbol: param, from };
      const args = Object.assign({}, { symbol: `TK${i}`, name: `Token ${i}`, from }, param);
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

  toAddress(to: Account): string {
    return typeof to === 'string' ? to : to.address;
  },
};
