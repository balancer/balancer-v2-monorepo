import { BigNumber, Contract, ContractFunction, ContractReceipt, ContractTransaction } from 'ethers';
import { BigNumberish, bn, fp, fpMul } from '../../../numbers';
import { MAX_UINT256, ZERO_ADDRESS } from '../../../constants';
import * as expectEvent from '../../../test/expectEvent';
import Vault from '../../vault/Vault';
import Token from '../../tokens/Token';
import TokenList from '../../tokens/TokenList';
import TypesConverter from '../../types/TypesConverter';
import WeightedPoolDeployer from './WeightedPoolDeployer';
import { MinimalSwap } from '../../vault/types';
import {
  JoinExitWeightedPool,
  InitWeightedPool,
  JoinGivenInWeightedPool,
  JoinGivenOutWeightedPool,
  JoinAllGivenOutWeightedPool,
  JoinResult,
  RawWeightedPoolDeployment,
  ExitResult,
  SwapResult,
  SingleExitGivenInWeightedPool,
  MultiExitGivenInWeightedPool,
  ExitGivenOutWeightedPool,
  SwapWeightedPool,
  ExitQueryResult,
  JoinQueryResult,
  PoolQueryResult,
  GradualWeightUpdateParams,
  GradualSwapFeeUpdateParams,
  WeightedPoolType,
  CircuitBreakerState,
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

import { Account, accountToAddress, SwapKind, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import BasePool from '../base/BasePool';
import assert from 'assert';

const MAX_IN_RATIO = fp(0.3);
const MAX_OUT_RATIO = fp(0.3);
const MAX_INVARIANT_RATIO = fp(3);
const MIN_INVARIANT_RATIO = fp(0.7);

export default class WeightedPool extends BasePool {
  weights: BigNumberish[];
  rateProviders: string[];
  assetManagers: string[];
  poolType: WeightedPoolType;
  swapEnabledOnStart: boolean;
  mustAllowlistLPs: boolean;
  managementAumFeePercentage: BigNumberish;
  aumProtocolFeesCollector: string;

  static async create(params: RawWeightedPoolDeployment = {}): Promise<WeightedPool> {
    return WeightedPoolDeployer.deploy(params);
  }

  constructor(
    instance: Contract,
    poolId: string,
    vault: Vault,
    tokens: TokenList,
    weights: BigNumberish[],
    rateProviders: string[],
    assetManagers: string[],
    swapFeePercentage: BigNumberish,
    poolType: WeightedPoolType,
    swapEnabledOnStart: boolean,
    mustAllowlistLPs: boolean,
    managementAumFeePercentage: BigNumberish,
    aumProtocolFeesCollector: string,
    owner?: SignerWithAddress
  ) {
    super(instance, poolId, vault, tokens, swapFeePercentage, owner);

    this.weights = weights;
    this.rateProviders = rateProviders;
    this.assetManagers = assetManagers;
    this.poolType = poolType;
    this.swapEnabledOnStart = swapEnabledOnStart;
    this.mustAllowlistLPs = mustAllowlistLPs;
    this.managementAumFeePercentage = managementAumFeePercentage;
    this.aumProtocolFeesCollector = aumProtocolFeesCollector;
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

  async getLastPostJoinExitInvariant(): Promise<BigNumber> {
    return this.instance.getLastPostJoinExitInvariant();
  }

  async getMaxInvariantDecrease(): Promise<BigNumber> {
    const supply = await this.totalSupply();
    return supply.sub(fpMul(MIN_INVARIANT_RATIO, supply));
  }

  async getMaxInvariantIncrease(): Promise<BigNumber> {
    const supply = await this.totalSupply();
    return fpMul(MAX_INVARIANT_RATIO, supply).sub(supply);
  }

  async getMaxIn(tokenIndex: number, currentBalances?: BigNumber[]): Promise<BigNumber> {
    if (!currentBalances) currentBalances = await this.getBalances();
    return fpMul(currentBalances[tokenIndex], MAX_IN_RATIO);
  }

  async getMaxOut(tokenIndex: number, currentBalances?: BigNumber[]): Promise<BigNumber> {
    if (!currentBalances) currentBalances = await this.getBalances();
    return fpMul(currentBalances[tokenIndex], MAX_OUT_RATIO);
  }

  async getSwapEnabled(from: SignerWithAddress): Promise<boolean> {
    return this.instance.connect(from).getSwapEnabled();
  }

  async getManagementAumFeeParams(): Promise<[BigNumber, BigNumber]> {
    return this.instance.getManagementAumFeeParams();
  }

  async getNormalizedWeights(): Promise<BigNumber[]> {
    return this.instance.getNormalizedWeights();
  }

  async estimateSpotPrice(currentBalances?: BigNumberish[]): Promise<BigNumber> {
    if (!currentBalances) currentBalances = await this.getBalances();

    const scalingFactors = await this.getScalingFactors();
    return calculateSpotPrice(
      currentBalances.map((x, i) => fpMul(x, scalingFactors[i])),
      this.weights
    );
  }

  async estimateBptPrice(
    tokenIndex: number,
    currentBalance?: BigNumberish,
    currentSupply?: BigNumberish
  ): Promise<BigNumber> {
    if (!currentBalance) currentBalance = (await this.getBalances())[tokenIndex];
    if (!currentSupply) currentSupply = await this.totalSupply();

    const scalingFactors = await this.getScalingFactors();

    return calculateBPTPrice(
      fpMul(currentBalance, scalingFactors[tokenIndex]),
      this.weights[tokenIndex],
      currentSupply
    );
  }

  async estimateInvariant(currentBalances?: BigNumberish[]): Promise<BigNumber> {
    if (!currentBalances) currentBalances = await this.getBalances();
    const scalingFactors = await this.getScalingFactors();

    return calculateInvariant(
      currentBalances.map((x, i) => fpMul(x, scalingFactors[i])),
      this.weights
    );
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
    return fpMul(bn(feeAmount), protocolFeePercentage);
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
    return fpMul(bn(feeAmount), protocolFeePercentage);
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

  async swapGivenIn(params: SwapWeightedPool): Promise<SwapResult> {
    return this.swap(await this._buildSwapParams(SwapKind.GivenIn, params));
  }

  async swapGivenOut(params: SwapWeightedPool): Promise<SwapResult> {
    return this.swap(await this._buildSwapParams(SwapKind.GivenOut, params));
  }

  async updateProtocolFeePercentageCache(): Promise<ContractTransaction> {
    return this.instance.updateProtocolFeePercentageCache();
  }

  async swap(params: MinimalSwap): Promise<SwapResult> {
    let receipt: ContractReceipt;
    if (this.vault.mocked) {
      const tx = await this.vault.minimalSwap(params);
      receipt = await tx.wait();
    } else {
      if (!params.from) throw new Error('No signer provided');
      const tx = await this.vault.instance.connect(params.from).swap(
        {
          poolId: params.poolId,
          kind: params.kind,
          assetIn: params.tokenIn,
          assetOut: params.tokenOut,
          amount: params.amount,
          userData: params.data,
        },
        {
          sender: TypesConverter.toAddress(params.from),
          recipient: TypesConverter.toAddress(params.to) ?? ZERO_ADDRESS,
          fromInternalBalance: false,
          toInternalBalance: false,
        },
        params.kind == 0 ? 0 : MAX_UINT256,
        MAX_UINT256
      );
      receipt = await tx.wait();
    }
    const { amountIn, amountOut } = expectEvent.inReceipt(receipt, 'Swap').args;
    const amount = params.kind == SwapKind.GivenIn ? amountOut : amountIn;

    return { amount, receipt };
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

  async joinAllGivenOut(params: JoinAllGivenOutWeightedPool): Promise<JoinResult> {
    return this.join(this._buildJoinAllGivenOutParams(params));
  }

  async queryJoinAllGivenOut(params: JoinAllGivenOutWeightedPool): Promise<JoinQueryResult> {
    return this.queryJoin(this._buildJoinAllGivenOutParams(params));
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
    const { tokens } = await this.getTokens();

    const tx = await this.vault.joinPool({
      poolAddress: this.address,
      poolId: this.poolId,
      recipient: to,
      currentBalances,
      tokens,
      lastChangeBlock: params.lastChangeBlock ?? 0,
      protocolFeePercentage: params.protocolFeePercentage ?? 0,
      data: params.data ?? '0x',
      from: params.from,
    });

    const receipt = await tx.wait();
    const { deltas, protocolFeeAmounts } = expectEvent.inReceipt(receipt, 'PoolBalanceChanged').args;
    return { amountsIn: deltas, dueProtocolFeeAmounts: protocolFeeAmounts, receipt };
  }

  async queryExit(params: JoinExitWeightedPool): Promise<ExitQueryResult> {
    const fn = this.instance.queryExit;
    return (await this._executeQuery(params, fn)) as ExitQueryResult;
  }

  async exit(params: JoinExitWeightedPool): Promise<ExitResult> {
    const currentBalances = params.currentBalances || (await this.getBalances());
    const to = params.recipient ? TypesConverter.toAddress(params.recipient) : params.from?.address ?? ZERO_ADDRESS;
    const { tokens } = await this.getTokens();

    const tx = await this.vault.exitPool({
      poolAddress: this.address,
      poolId: this.poolId,
      recipient: to,
      currentBalances,
      tokens,
      lastChangeBlock: params.lastChangeBlock ?? 0,
      protocolFeePercentage: params.protocolFeePercentage ?? 0,
      data: params.data ?? '0x',
      from: params.from,
    });

    const receipt = await tx.wait();
    const { deltas, protocolFeeAmounts } = expectEvent.inReceipt(receipt, 'PoolBalanceChanged').args;
    return { amountsOut: deltas.map((x: BigNumber) => x.mul(-1)), dueProtocolFeeAmounts: protocolFeeAmounts, receipt };
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
    const { tokens } = await this.vault.getPoolTokens(this.poolId);
    const tokenIn = typeof params.in === 'number' ? tokens[params.in] : params.in.address;
    const tokenOut = typeof params.out === 'number' ? tokens[params.out] : params.out.address;
    return {
      kind,
      poolAddress: this.address,
      poolId: this.poolId,
      from: params.from,
      to: params.recipient ?? ZERO_ADDRESS,
      tokenIn: tokenIn ?? ZERO_ADDRESS,
      tokenOut: tokenOut ?? ZERO_ADDRESS,
      balanceTokenIn: currentBalances[tokens.indexOf(tokenIn)] || bn(0),
      balanceTokenOut: currentBalances[tokens.indexOf(tokenOut)] || bn(0),
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

  private _buildJoinAllGivenOutParams(params: JoinAllGivenOutWeightedPool): JoinExitWeightedPool {
    return {
      from: params.from,
      recipient: params.recipient,
      lastChangeBlock: params.lastChangeBlock,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: WeightedPoolEncoder.joinAllTokensInForExactBPTOut(params.bptOut),
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

  private _isManagedPool() {
    return this.poolType == WeightedPoolType.MANAGED_POOL || this.poolType == WeightedPoolType.MOCK_MANAGED_POOL;
  }

  async setSwapEnabled(from: SignerWithAddress, swapEnabled: boolean): Promise<ContractTransaction> {
    const pool = this.instance.connect(from);
    return pool.setSwapEnabled(swapEnabled);
  }

  async setSwapFeePercentage(from: SignerWithAddress, swapFeePercentage: BigNumberish): Promise<ContractTransaction> {
    if (this._isManagedPool()) {
      throw new Error('Not available in managed pool');
    }
    const pool = this.instance.connect(from);
    return pool.setSwapFeePercentage(swapFeePercentage);
  }

  async setManagementAumFeePercentage(
    from: SignerWithAddress,
    managementFee: BigNumberish
  ): Promise<ContractTransaction> {
    const pool = this.instance.connect(from);
    return pool.setManagementAumFeePercentage(managementFee);
  }

  async addAllowedAddress(from: SignerWithAddress, member: Account): Promise<ContractTransaction> {
    const pool = this.instance.connect(from);
    return pool.addAllowedAddress(TypesConverter.toAddress(member));
  }

  async removeAllowedAddress(from: SignerWithAddress, member: Account): Promise<ContractTransaction> {
    const pool = this.instance.connect(from);
    return pool.removeAllowedAddress(TypesConverter.toAddress(member));
  }

  async getMustAllowlistLPs(): Promise<boolean> {
    return this.instance.getMustAllowlistLPs();
  }

  async setMustAllowlistLPs(from: SignerWithAddress, mustAllowlistLPs: boolean): Promise<ContractTransaction> {
    const pool = this.instance.connect(from);
    return pool.setMustAllowlistLPs(mustAllowlistLPs);
  }

  async isAllowedAddress(member: string): Promise<boolean> {
    return this.instance.isAllowedAddress(member);
  }

  async collectAumManagementFees(from: SignerWithAddress): Promise<ContractTransaction> {
    const pool = this.instance.connect(from);
    return pool.collectAumManagementFees();
  }

  async updateWeightsGradually(
    from: SignerWithAddress,
    startTime: BigNumberish,
    endTime: BigNumberish,
    endWeights: BigNumberish[],
    tokens?: string[]
  ): Promise<ContractTransaction> {
    const pool = this.instance.connect(from);

    if (this._isManagedPool()) {
      if (!tokens) {
        const { tokens: registeredTokens } = await this.getTokens();
        // If the first token is BPT then we can assume that the Pool is composable.
        if (registeredTokens[0] == this.address) {
          tokens = registeredTokens.slice(1);
        } else {
          tokens = registeredTokens;
        }
      }

      return await pool.updateWeightsGradually(startTime, endTime, tokens, endWeights);
    }

    return await pool.updateWeightsGradually(startTime, endTime, endWeights);
  }

  async updateSwapFeeGradually(
    from: SignerWithAddress,
    startTime: BigNumberish,
    endTime: BigNumberish,
    startSwapFeePercentage: BigNumberish,
    endSwapFeePercentage: BigNumberish
  ): Promise<ContractTransaction> {
    assert(this._isManagedPool(), 'Only available in managed pool');
    const pool = this.instance.connect(from);
    return await pool.updateSwapFeeGradually(startTime, endTime, startSwapFeePercentage, endSwapFeePercentage);
  }

  async setCircuitBreakers(
    from: SignerWithAddress,
    tokens: Token[] | string[],
    bptPrices: BigNumber[],
    lowerBounds: BigNumber[],
    upperBounds: BigNumber[]
  ): Promise<ContractTransaction> {
    const tokensArg = tokens.map((t) => TypesConverter.toAddress(t));
    const pool = this.instance.connect(from);

    return await pool.setCircuitBreakers(tokensArg, bptPrices, lowerBounds, upperBounds);
  }

  async getGradualWeightUpdateParams(from?: SignerWithAddress): Promise<GradualWeightUpdateParams> {
    const pool = from ? this.instance.connect(from) : this.instance;
    return await pool.getGradualWeightUpdateParams();
  }

  async getGradualSwapFeeUpdateParams(from?: SignerWithAddress): Promise<GradualSwapFeeUpdateParams> {
    const pool = from ? this.instance.connect(from) : this.instance;
    return await pool.getGradualSwapFeeUpdateParams();
  }

  async getCircuitBreakerState(token: Token | string): Promise<CircuitBreakerState> {
    return await this.instance.getCircuitBreakerState(TypesConverter.toAddress(token));
  }

  async addToken(
    from: SignerWithAddress,
    token: Token | string,
    assetManager: Account,
    normalizedWeight: BigNumberish,
    mintAmount?: BigNumberish,
    recipient?: string
  ): Promise<ContractTransaction> {
    return this.instance
      .connect(from)
      .addToken(
        TypesConverter.toAddress(token),
        accountToAddress(assetManager),
        normalizedWeight,
        mintAmount ?? 0,
        recipient ?? from.address
      );
  }

  async removeToken(
    from: SignerWithAddress,
    token: Token | string,
    sender?: string,
    burnAmount?: BigNumberish
  ): Promise<ContractTransaction> {
    return this.instance
      .connect(from)
      .removeToken(TypesConverter.toAddress(token), burnAmount ?? 0, sender ?? from.address);
  }
}
