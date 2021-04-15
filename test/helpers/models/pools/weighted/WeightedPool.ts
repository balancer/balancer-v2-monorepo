import { BigNumber, Contract, ContractFunction } from 'ethers';

import { roleId } from '../../../../../lib/helpers/roles';
import { BigNumberish, bn, fp } from '../../../../../lib/helpers/numbers';
import { MAX_UINT256, ZERO_ADDRESS } from '../../../../../lib/helpers/constants';
import { encodeExitWeightedPool, encodeJoinWeightedPool } from '../../../../../lib/helpers/weightedPoolEncoding';

import * as expectEvent from '../../../expectEvent';
import Vault from '../../vault/Vault';
import Token from '../../tokens/Token';
import TokenList from '../../tokens/TokenList';
import TypesConverter from '../../types/TypesConverter';
import WeightedPoolDeployer from './WeightedPoolDeployer';
import { Account } from '../../types/types';
import {
  JoinExitWeightedPool,
  InitWeightedPool,
  JoinGivenInWeightedPool,
  JoinGivenOutWeightedPool,
  JoinResult,
  RawWeightedPoolDeployment,
  ExitResult,
  SingleExitGivenInWeightedPool,
  MultiExitGivenInWeightedPool,
  ExitGivenOutWeightedPool,
  SwapWeightedPool,
  ExitQueryResult,
  JoinQueryResult,
  PoolQueryResult,
} from './types';
import {
  calculateInvariant,
  calcBptOutGivenExactTokensIn,
  calcTokenInGivenExactBptOut,
  calcTokenOutGivenExactBptIn,
  calcOutGivenIn,
  calculateOneTokenSwapFee,
  calcInGivenOut,
  calculateMaxOneTokenSwapFee,
} from '../../../math/weighted';

const SWAP_GIVEN = { IN: 0, OUT: 1 };
const MAX_IN_RATIO = fp(0.3);
const MAX_OUT_RATIO = fp(0.3);
const MAX_INVARIANT_RATIO = fp(3);
const MIN_INVARIANT_RATIO = fp(0.7);

export default class WeightedPool {
  instance: Contract;
  poolId: string;
  tokens: TokenList;
  weights: BigNumberish[];
  swapFee: BigNumberish;
  vault: Vault;

  static async create(params: RawWeightedPoolDeployment = {}): Promise<WeightedPool> {
    return WeightedPoolDeployer.deploy(params);
  }

  constructor(
    instance: Contract,
    poolId: string,
    vault: Vault,
    tokens: TokenList,
    weights: BigNumberish[],
    swapFee: BigNumberish
  ) {
    this.instance = instance;
    this.poolId = poolId;
    this.vault = vault;
    this.tokens = tokens;
    this.weights = weights;
    this.swapFee = swapFee;
  }

  get address(): string {
    return this.instance.address;
  }

  get maxWeight(): BigNumberish {
    return this.weights.reduce((max, weight) => (bn(weight).gt(max) ? weight : max), bn(0));
  }

  get normalizedWeights(): BigNumberish[] {
    return this.weights;
  }

  async name(): Promise<string> {
    return this.instance.name();
  }

  async symbol(): Promise<string> {
    return this.instance.symbol();
  }

  async decimals(): Promise<BigNumber> {
    return this.instance.decimals();
  }

  async totalSupply(): Promise<BigNumber> {
    return this.instance.totalSupply();
  }

  async balanceOf(account: Account): Promise<BigNumber> {
    return this.instance.balanceOf(TypesConverter.toAddress(account));
  }

  async getVault(): Promise<string> {
    return this.instance.getVault();
  }

  async getRegisteredInfo(): Promise<{ address: string; specialization: BigNumber }> {
    return this.vault.getPool(this.poolId);
  }

  async getPoolId(): Promise<string> {
    return this.instance.getPoolId();
  }

  async getLastInvariant(): Promise<BigNumber> {
    return this.instance.getLastInvariant();
  }

  async getMaxInvariantDecrease(): Promise<BigNumber> {
    const supply = await this.totalSupply();
    return supply.sub(MIN_INVARIANT_RATIO.mul(supply).div(fp(1)));
  }

  async getMaxInvariantIncrease(): Promise<BigNumber> {
    const supply = await this.totalSupply();
    return MAX_INVARIANT_RATIO.mul(supply).div(fp(1)).sub(supply);
  }

  async getMaxIn(tokenIndex: number, currentBalances?: BigNumber[]): Promise<BigNumber> {
    if (!currentBalances) currentBalances = await this.getBalances();
    return currentBalances[tokenIndex].mul(MAX_IN_RATIO).div(fp(1));
  }

  async getMaxOut(tokenIndex: number, currentBalances?: BigNumber[]): Promise<BigNumber> {
    if (!currentBalances) currentBalances = await this.getBalances();
    return currentBalances[tokenIndex].mul(MAX_OUT_RATIO).div(fp(1));
  }

  async getSwapFee(): Promise<BigNumber> {
    return this.instance.getSwapFee();
  }

  async getNormalizedWeights(): Promise<BigNumber[]> {
    return this.instance.getNormalizedWeights();
  }

  async getTokens(): Promise<{ tokens: string[]; balances: BigNumber[]; lastChangeBlock: BigNumber }> {
    return this.vault.getPoolTokens(this.poolId);
  }

  async getBalances(): Promise<BigNumber[]> {
    const { balances } = await this.getTokens();
    return balances;
  }

  async getTokenInfo(
    token: Token
  ): Promise<{ cash: BigNumber; managed: BigNumber; blockNumber: BigNumber; assetManager: string }> {
    return this.vault.getPoolTokenInfo(this.poolId, token);
  }

  async estimateInvariant(currentBalances?: BigNumberish[]): Promise<BigNumber> {
    if (!currentBalances) currentBalances = await this.getBalances();
    return calculateInvariant(currentBalances, this.weights);
  }

  async estimateSwapFee(
    paidToken: number | Token,
    protocolFeePercentage: BigNumberish,
    currentBalances?: BigNumberish[]
  ): Promise<BigNumber> {
    if (!currentBalances) currentBalances = await this.getBalances();
    const lastInvariant = await this.estimateInvariant();
    const paidTokenIndex = this.tokens.indexOf(paidToken);
    const feeAmount = calculateOneTokenSwapFee(currentBalances, this.weights, lastInvariant, paidTokenIndex);
    return bn(feeAmount).mul(protocolFeePercentage).div(fp(1));
  }

  async estimateMaxSwapFee(
    paidToken: number | Token,
    protocolFeePercentage: BigNumberish,
    currentBalances?: BigNumberish[]
  ): Promise<BigNumber> {
    if (!currentBalances) currentBalances = await this.getBalances();
    const paidTokenIndex = this.tokens.indexOf(paidToken);
    const feeAmount = calculateMaxOneTokenSwapFee(currentBalances, this.weights, MIN_INVARIANT_RATIO, paidTokenIndex);
    return bn(feeAmount).mul(protocolFeePercentage).div(fp(1));
  }

  async estimateGivenIn(params: SwapWeightedPool, currentBalances?: BigNumberish[]): Promise<BigNumberish> {
    if (!currentBalances) currentBalances = await this.getBalances();
    const [tokenIn, tokenOut] = this.tokens.indicesOf(params.in, params.out);

    return bn(
      calcOutGivenIn(
        currentBalances[tokenIn],
        this.weights[tokenIn],
        currentBalances[tokenOut],
        this.weights[tokenOut],
        params.amount
      )
    );
  }

  async estimateGivenOut(params: SwapWeightedPool, currentBalances?: BigNumberish[]): Promise<BigNumberish> {
    if (!currentBalances) currentBalances = await this.getBalances();
    const [tokenIn, tokenOut] = this.tokens.indicesOf(params.in, params.out);

    return bn(
      calcInGivenOut(
        currentBalances[tokenIn],
        this.weights[tokenIn],
        currentBalances[tokenOut],
        this.weights[tokenOut],
        params.amount
      )
    );
  }

  async estimateBptOut(
    amountsIn: BigNumberish[],
    currentBalances?: BigNumberish[],
    supply?: BigNumberish
  ): Promise<BigNumberish> {
    if (!supply) supply = await this.totalSupply();
    if (!currentBalances) currentBalances = await this.getBalances();
    return calcBptOutGivenExactTokensIn(currentBalances, this.weights, amountsIn, supply, this.swapFee);
  }

  async estimateTokenIn(
    token: number | Token,
    bptOut: BigNumberish,
    currentBalances?: BigNumberish[],
    supply?: BigNumberish
  ): Promise<BigNumberish> {
    if (!supply) supply = await this.totalSupply();
    if (!currentBalances) currentBalances = await this.getBalances();
    const tokenIndex = this.tokens.indexOf(token);
    return calcTokenInGivenExactBptOut(tokenIndex, currentBalances, this.weights, bptOut, supply, this.swapFee);
  }

  async estimateTokenOut(
    token: number | Token,
    bptIn: BigNumberish,
    currentBalances?: BigNumberish[],
    supply?: BigNumberish
  ): Promise<BigNumberish> {
    if (!supply) supply = await this.totalSupply();
    if (!currentBalances) currentBalances = await this.getBalances();
    const tokenIndex = this.tokens.indexOf(token);
    return calcTokenOutGivenExactBptIn(tokenIndex, currentBalances, this.weights, bptIn, supply, this.swapFee);
  }

  async swapGivenIn(params: SwapWeightedPool): Promise<BigNumber> {
    const currentBalances = await this.getBalances();
    const [tokenIn, tokenOut] = this.tokens.indicesOf(params.in, params.out);

    return this.instance.onSwap(
      {
        kind: SWAP_GIVEN.IN,
        poolId: this.poolId,
        from: params.from ?? ZERO_ADDRESS,
        to: params.recipient ?? ZERO_ADDRESS,
        tokenIn: this.tokens.get(params.in)?.address ?? ZERO_ADDRESS,
        tokenOut: this.tokens.get(params.out)?.address ?? ZERO_ADDRESS,
        latestBlockNumberUsed: params.latestBlockNumberUsed ?? 0,
        userData: params.data ?? '0x',
        amount: params.amount,
      },
      currentBalances[tokenIn] || bn(0),
      currentBalances[tokenOut] || bn(0)
    );
  }

  async swapGivenOut(params: SwapWeightedPool): Promise<BigNumber> {
    const currentBalances = await this.getBalances();
    const [tokenIn, tokenOut] = this.tokens.indicesOf(params.in, params.out);

    return this.instance.onSwap(
      {
        kind: SWAP_GIVEN.OUT,
        poolId: this.poolId,
        from: params.from ?? ZERO_ADDRESS,
        to: params.recipient ?? ZERO_ADDRESS,
        tokenIn: this.tokens.get(params.in)?.address ?? ZERO_ADDRESS,
        tokenOut: this.tokens.get(params.out)?.address ?? ZERO_ADDRESS,
        latestBlockNumberUsed: params.latestBlockNumberUsed ?? 0,
        userData: params.data ?? '0x',
        amount: params.amount,
      },
      currentBalances[tokenIn] || bn(0),
      currentBalances[tokenOut] || bn(0)
    );
  }

  async init(params: InitWeightedPool): Promise<JoinResult> {
    return this.join(this._buildInitParams(params));
  }

  async joinGivenIn(params: JoinGivenInWeightedPool): Promise<JoinResult> {
    return this.join(this._buildJoinGivenInParams(params));
  }

  async queryJoinGivenIn(params: JoinGivenInWeightedPool): Promise<JoinQueryResult> {
    return this.queryJoin(this._buildJoinGivenInParams(params));
  }

  async joinGivenOut(params: JoinGivenOutWeightedPool): Promise<JoinResult> {
    return this.join(this._buildJoinGivenOutParams(params));
  }

  async queryJoinGivenOut(params: JoinGivenOutWeightedPool): Promise<JoinQueryResult> {
    return this.queryJoin(this._buildJoinGivenOutParams(params));
  }

  async exitGivenOut(params: ExitGivenOutWeightedPool): Promise<ExitResult> {
    return this.exit(this._buildExitGivenOutParams(params));
  }

  async queryExitGivenOut(params: ExitGivenOutWeightedPool): Promise<ExitQueryResult> {
    return this.queryExit(this._buildExitGivenOutParams(params));
  }

  async singleExitGivenIn(params: SingleExitGivenInWeightedPool): Promise<ExitResult> {
    return this.exit(this._buildSingleExitGivenInParams(params));
  }

  async querySingleExitGivenIn(params: SingleExitGivenInWeightedPool): Promise<ExitQueryResult> {
    return this.queryExit(this._buildSingleExitGivenInParams(params));
  }

  async multiExitGivenIn(params: MultiExitGivenInWeightedPool): Promise<ExitResult> {
    return this.exit(this._buildMultiExitGivenInParams(params));
  }

  async queryMultiExitGivenIn(params: MultiExitGivenInWeightedPool): Promise<ExitQueryResult> {
    return this.queryExit(this._buildMultiExitGivenInParams(params));
  }

  async queryJoin(params: JoinExitWeightedPool): Promise<JoinQueryResult> {
    const fn = this.instance.queryJoin;
    return (await this._executeQuery(params, fn)) as JoinQueryResult;
  }

  async join(params: JoinExitWeightedPool): Promise<JoinResult> {
    const currentBalances = params.currentBalances || (await this.getBalances());
    const to = params.recipient ? TypesConverter.toAddress(params.recipient) : params.from?.address ?? ZERO_ADDRESS;

    const tx = this.vault.joinPool({
      poolAddress: this.address,
      poolId: this.poolId,
      recipient: to,
      currentBalances,
      tokens: this.tokens.addresses,
      latestBlockNumberUsed: params.latestBlockNumberUsed ?? 0,
      protocolFeePercentage: params.protocolFeePercentage ?? 0,
      data: params.data ?? '0x',
      from: params.from,
    });

    const receipt = await (await tx).wait();
    const { deltas, protocolFees } = expectEvent.inReceipt(receipt, 'PoolBalanceChanged').args;
    return { amountsIn: deltas, dueProtocolFeeAmounts: protocolFees };
  }

  async queryExit(params: JoinExitWeightedPool): Promise<ExitQueryResult> {
    const fn = this.instance.queryExit;
    return (await this._executeQuery(params, fn)) as ExitQueryResult;
  }

  async exit(params: JoinExitWeightedPool): Promise<ExitResult> {
    const currentBalances = params.currentBalances || (await this.getBalances());
    const to = params.recipient ? TypesConverter.toAddress(params.recipient) : params.from?.address ?? ZERO_ADDRESS;

    const tx = await this.vault.exitPool({
      poolAddress: this.address,
      poolId: this.poolId,
      recipient: to,
      currentBalances,
      tokens: this.tokens.addresses,
      latestBlockNumberUsed: params.latestBlockNumberUsed ?? 0,
      protocolFeePercentage: params.protocolFeePercentage ?? 0,
      data: params.data ?? '0x',
      from: params.from,
    });

    const receipt = await (await tx).wait();
    const { deltas, protocolFees } = expectEvent.inReceipt(receipt, 'PoolBalanceChanged').args;
    return { amountsOut: deltas.map((x: BigNumber) => x.mul(-1)), dueProtocolFeeAmounts: protocolFees };
  }

  private async _executeQuery(params: JoinExitWeightedPool, fn: ContractFunction): Promise<PoolQueryResult> {
    const currentBalances = params.currentBalances || (await this.getBalances());
    const to = params.recipient ? TypesConverter.toAddress(params.recipient) : params.from?.address ?? ZERO_ADDRESS;

    return fn(
      this.poolId,
      params.from?.address || ZERO_ADDRESS,
      to,
      currentBalances,
      params.latestBlockNumberUsed ?? 0,
      params.protocolFeePercentage ?? 0,
      params.data ?? '0x'
    );
  }

  private _buildInitParams(params: InitWeightedPool): JoinExitWeightedPool {
    const { initialBalances: balances } = params;
    const amountsIn = Array.isArray(balances) ? balances : Array(this.tokens.length).fill(balances);

    return {
      from: params.from,
      recipient: params.recipient,
      protocolFeePercentage: params.protocolFeePercentage,
      data: encodeJoinWeightedPool({
        kind: 'Init',
        amountsIn,
      }),
    };
  }

  private _buildJoinGivenInParams(params: JoinGivenInWeightedPool): JoinExitWeightedPool {
    const { amountsIn: amounts } = params;
    const amountsIn = Array.isArray(amounts) ? amounts : Array(this.tokens.length).fill(amounts);

    return {
      from: params.from,
      recipient: params.recipient,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: encodeJoinWeightedPool({
        kind: 'ExactTokensInForBPTOut',
        amountsIn,
        minimumBPT: params.minimumBptOut ?? 0,
      }),
    };
  }

  private _buildJoinGivenOutParams(params: JoinGivenOutWeightedPool): JoinExitWeightedPool {
    return {
      from: params.from,
      recipient: params.recipient,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: encodeJoinWeightedPool({
        kind: 'TokenInForExactBPTOut',
        bptAmountOut: params.bptOut,
        enterTokenIndex: this.tokens.indexOf(params.token),
      }),
    };
  }

  private _buildExitGivenOutParams(params: ExitGivenOutWeightedPool): JoinExitWeightedPool {
    const { amountsOut: amounts } = params;
    const amountsOut = Array.isArray(amounts) ? amounts : Array(this.tokens.length).fill(amounts);
    return {
      from: params.from,
      recipient: params.recipient,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: encodeExitWeightedPool({
        kind: 'BPTInForExactTokensOut',
        amountsOut,
        maxBPTAmountIn: params.maximumBptIn ?? MAX_UINT256,
      }),
    };
  }

  private _buildSingleExitGivenInParams(params: SingleExitGivenInWeightedPool): JoinExitWeightedPool {
    return {
      from: params.from,
      recipient: params.recipient,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: encodeExitWeightedPool({
        kind: 'ExactBPTInForOneTokenOut',
        bptAmountIn: params.bptIn,
        exitTokenIndex: this.tokens.indexOf(params.token),
      }),
    };
  }

  private _buildMultiExitGivenInParams(params: MultiExitGivenInWeightedPool): JoinExitWeightedPool {
    return {
      from: params.from,
      recipient: params.recipient,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: encodeExitWeightedPool({
        kind: 'ExactBPTInForTokensOut',
        bptAmountIn: params.bptIn,
      }),
    };
  }

  async pause(): Promise<void> {
    const role = roleId(this.instance, 'setPaused');
    await this.vault.grantRole(role);
    await this.instance.setPaused(true);
  }
}
