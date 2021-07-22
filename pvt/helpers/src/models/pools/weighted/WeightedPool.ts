import { BigNumber, Contract, ContractFunction, ContractTransaction } from 'ethers';

import { actionId } from '../../misc/actions';
import { BigNumberish, bn, fp } from '../../../numbers';
import { MAX_UINT256, ZERO_ADDRESS } from '../../../constants';

import * as expectEvent from '../../../test/expectEvent';
import Vault from '../../vault/Vault';
import Token from '../../tokens/Token';
import TokenList from '../../tokens/TokenList';
import TypesConverter from '../../types/TypesConverter';
import WeightedPoolDeployer from './WeightedPoolDeployer';
import { MinimalSwap } from '../../vault/types';
import { Account, TxParams } from '../../types/types';
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
  MiscData,
  Sample,
  GradualUpdateParams,
} from './types';
import {
  calculateInvariant,
  calcBptOutGivenExactTokensIn,
  calcTokenInGivenExactBptOut,
  calcTokenOutGivenExactBptIn,
  calcOutGivenIn,
  calculateOneTokenSwapFeeAmount,
  calcInGivenOut,
  calculateMaxOneTokenSwapFeeAmount,
  calculateSpotPrice,
  calculateBPTPrice,
} from './math';
import { SwapKind, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

const MAX_IN_RATIO = fp(0.3);
const MAX_OUT_RATIO = fp(0.3);
const MAX_INVARIANT_RATIO = fp(3);
const MIN_INVARIANT_RATIO = fp(0.7);

export default class WeightedPool {
  instance: Contract;
  poolId: string;
  tokens: TokenList;
  weights: BigNumberish[];
  assetManagers: string[];
  swapFeePercentage: BigNumberish;
  vault: Vault;
  twoTokens: boolean;
  lbp: boolean;
  swapEnabledOnStart: boolean;

  static async create(params: RawWeightedPoolDeployment = {}): Promise<WeightedPool> {
    return WeightedPoolDeployer.deploy(params);
  }

  constructor(
    instance: Contract,
    poolId: string,
    vault: Vault,
    tokens: TokenList,
    weights: BigNumberish[],
    assetManagers: string[],
    swapFeePercentage: BigNumberish,
    twoTokens: boolean,
    lbp: boolean,
    swapEnabledOnStart: boolean
  ) {
    this.instance = instance;
    this.poolId = poolId;
    this.vault = vault;
    this.tokens = tokens;
    this.weights = weights;
    this.assetManagers = assetManagers;
    this.swapFeePercentage = swapFeePercentage;
    this.twoTokens = twoTokens;
    this.lbp = lbp;
    this.swapEnabledOnStart = swapEnabledOnStart;
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

  get maxWeightIndex(): BigNumberish {
    const maxIdx = this.weights.indexOf(this.maxWeight);
    return bn(maxIdx);
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

  async isOracleEnabled(): Promise<boolean> {
    if (!this.twoTokens) throw Error('Cannot query misc data for non-2-tokens weighted pool');
    return (await this.getMiscData()).oracleEnabled;
  }

  async getMiscData(): Promise<MiscData> {
    if (!this.twoTokens) throw Error('Cannot query misc data for non-2-tokens weighted pool');
    return this.instance.getMiscData();
  }

  async getOracleSample(oracleIndex?: BigNumberish): Promise<Sample> {
    if (!oracleIndex) oracleIndex = (await this.getMiscData()).oracleIndex;
    return this.instance.getSample(oracleIndex);
  }

  async getSwapFeePercentage(): Promise<BigNumber> {
    return this.instance.getSwapFeePercentage();
  }

  async getSwapEnabled(from: SignerWithAddress): Promise<boolean> {
    return this.instance.connect(from).getSwapEnabled();
  }

  async getNormalizedWeights(): Promise<BigNumber[]> {
    return this.instance.getNormalizedWeights();
  }

  async getScalingFactors(): Promise<BigNumber[]> {
    return this.instance.getScalingFactors();
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
  ): Promise<{ cash: BigNumber; managed: BigNumber; lastChangeBlock: BigNumber; assetManager: string }> {
    return this.vault.getPoolTokenInfo(this.poolId, token);
  }

  async estimateSpotPrice(currentBalances?: BigNumberish[]): Promise<BigNumber> {
    if (!currentBalances) currentBalances = await this.getBalances();
    return calculateSpotPrice(currentBalances, this.weights);
  }

  async estimateBptPrice(
    tokenIndex: number,
    currentBalance?: BigNumberish,
    currentSupply?: BigNumberish
  ): Promise<BigNumber> {
    if (!currentBalance) currentBalance = (await this.getBalances())[tokenIndex];
    if (!currentSupply) currentSupply = await this.totalSupply();
    return calculateBPTPrice(currentBalance, this.weights[tokenIndex], currentSupply);
  }

  async estimateInvariant(currentBalances?: BigNumberish[]): Promise<BigNumber> {
    if (!currentBalances) currentBalances = await this.getBalances();
    return calculateInvariant(currentBalances, this.weights);
  }

  async estimateSwapFeeAmount(
    paidToken: number | Token,
    protocolFeePercentage: BigNumberish,
    currentBalances?: BigNumberish[]
  ): Promise<BigNumber> {
    if (!currentBalances) currentBalances = await this.getBalances();
    const lastInvariant = await this.estimateInvariant();
    const paidTokenIndex = this.tokens.indexOf(paidToken);
    const feeAmount = calculateOneTokenSwapFeeAmount(currentBalances, this.weights, lastInvariant, paidTokenIndex);
    return bn(feeAmount).mul(protocolFeePercentage).div(fp(1));
  }

  async estimateMaxSwapFeeAmount(
    paidToken: number | Token,
    protocolFeePercentage: BigNumberish,
    currentBalances?: BigNumberish[]
  ): Promise<BigNumber> {
    if (!currentBalances) currentBalances = await this.getBalances();
    const paidTokenIndex = this.tokens.indexOf(paidToken);
    const feeAmount = calculateMaxOneTokenSwapFeeAmount(
      currentBalances,
      this.weights,
      MIN_INVARIANT_RATIO,
      paidTokenIndex
    );
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
    return calcBptOutGivenExactTokensIn(currentBalances, this.weights, amountsIn, supply, this.swapFeePercentage);
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
    return calcTokenInGivenExactBptOut(
      tokenIndex,
      currentBalances,
      this.weights,
      bptOut,
      supply,
      this.swapFeePercentage
    );
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
    return calcTokenOutGivenExactBptIn(
      tokenIndex,
      currentBalances,
      this.weights,
      bptIn,
      supply,
      this.swapFeePercentage
    );
  }

  async swapGivenIn(params: SwapWeightedPool): Promise<BigNumber> {
    return this.swap(await this._buildSwapParams(SwapKind.GivenIn, params));
  }

  async swapGivenOut(params: SwapWeightedPool): Promise<BigNumber> {
    return this.swap(await this._buildSwapParams(SwapKind.GivenOut, params));
  }

  async swap(params: MinimalSwap): Promise<BigNumber> {
    const tx = await this.vault.minimalSwap(params);
    const receipt = await (await tx).wait();
    const { amount } = expectEvent.inReceipt(receipt, 'Swap').args;
    return amount;
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
      lastChangeBlock: params.lastChangeBlock ?? 0,
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
      lastChangeBlock: params.lastChangeBlock ?? 0,
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
      params.lastChangeBlock ?? 0,
      params.protocolFeePercentage ?? 0,
      params.data ?? '0x'
    );
  }

  private async _buildSwapParams(kind: number, params: SwapWeightedPool): Promise<MinimalSwap> {
    const currentBalances = await this.getBalances();
    const [tokenIn, tokenOut] = this.tokens.indicesOf(params.in, params.out);
    return {
      kind,
      poolAddress: this.address,
      poolId: this.poolId,
      from: params.from,
      to: params.recipient ?? ZERO_ADDRESS,
      tokenIn: this.tokens.get(params.in)?.address ?? ZERO_ADDRESS,
      tokenOut: this.tokens.get(params.out)?.address ?? ZERO_ADDRESS,
      balanceTokenIn: currentBalances[tokenIn] || bn(0),
      balanceTokenOut: currentBalances[tokenOut] || bn(0),
      lastChangeBlock: params.lastChangeBlock ?? 0,
      data: params.data ?? '0x',
      amount: params.amount,
    };
  }

  private _buildInitParams(params: InitWeightedPool): JoinExitWeightedPool {
    const { initialBalances: balances } = params;
    const amountsIn = Array.isArray(balances) ? balances : Array(this.tokens.length).fill(balances);

    return {
      from: params.from,
      recipient: params.recipient,
      protocolFeePercentage: params.protocolFeePercentage,
      data: WeightedPoolEncoder.joinInit(amountsIn),
    };
  }

  private _buildJoinGivenInParams(params: JoinGivenInWeightedPool): JoinExitWeightedPool {
    const { amountsIn: amounts } = params;
    const amountsIn = Array.isArray(amounts) ? amounts : Array(this.tokens.length).fill(amounts);

    return {
      from: params.from,
      recipient: params.recipient,
      lastChangeBlock: params.lastChangeBlock,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: WeightedPoolEncoder.joinExactTokensInForBPTOut(amountsIn, params.minimumBptOut ?? 0),
    };
  }

  private _buildJoinGivenOutParams(params: JoinGivenOutWeightedPool): JoinExitWeightedPool {
    return {
      from: params.from,
      recipient: params.recipient,
      lastChangeBlock: params.lastChangeBlock,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: WeightedPoolEncoder.joinTokenInForExactBPTOut(params.bptOut, this.tokens.indexOf(params.token)),
    };
  }

  private _buildExitGivenOutParams(params: ExitGivenOutWeightedPool): JoinExitWeightedPool {
    const { amountsOut: amounts } = params;
    const amountsOut = Array.isArray(amounts) ? amounts : Array(this.tokens.length).fill(amounts);
    return {
      from: params.from,
      recipient: params.recipient,
      lastChangeBlock: params.lastChangeBlock,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: WeightedPoolEncoder.exitBPTInForExactTokensOut(amountsOut, params.maximumBptIn ?? MAX_UINT256),
    };
  }

  private _buildSingleExitGivenInParams(params: SingleExitGivenInWeightedPool): JoinExitWeightedPool {
    return {
      from: params.from,
      recipient: params.recipient,
      lastChangeBlock: params.lastChangeBlock,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: WeightedPoolEncoder.exitExactBPTInForOneTokenOut(params.bptIn, this.tokens.indexOf(params.token)),
    };
  }

  private _buildMultiExitGivenInParams(params: MultiExitGivenInWeightedPool): JoinExitWeightedPool {
    return {
      from: params.from,
      recipient: params.recipient,
      lastChangeBlock: params.lastChangeBlock,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: WeightedPoolEncoder.exitExactBPTInForTokensOut(params.bptIn),
    };
  }

  async pause(): Promise<void> {
    const action = await actionId(this.instance, 'setPaused');
    await this.vault.grantRole(action);
    await this.instance.setPaused(true);
  }

  async enableOracle(txParams: TxParams): Promise<void> {
    const pool = txParams.from ? this.instance.connect(txParams.from) : this.instance;
    await pool.enableOracle();
  }

  async setSwapEnabled(from: SignerWithAddress, swapEnabled: boolean): Promise<ContractTransaction> {
    const pool = this.instance.connect(from);
    return pool.setSwapEnabled(swapEnabled);
  }

  async updateWeightsGradually(
    from: SignerWithAddress,
    startTime: BigNumberish,
    endTime: BigNumberish,
    endWeights: BigNumberish[]
  ): Promise<ContractTransaction> {
    const pool = this.instance.connect(from);
    return await pool.updateWeightsGradually(startTime, endTime, endWeights);
  }

  async getGradualWeightUpdateParams(from?: SignerWithAddress): Promise<GradualUpdateParams> {
    const pool = from ? this.instance.connect(from) : this.instance;
    return await pool.getGradualWeightUpdateParams();
  }
}
