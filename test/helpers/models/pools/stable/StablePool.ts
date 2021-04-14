import { BigNumber, Contract, ContractFunction } from 'ethers';

import { roleId } from '../../../../../lib/helpers/roles';
import { BigNumberish, bn, fp } from '../../../../../lib/helpers/numbers';
import { MAX_UINT256, ZERO_ADDRESS } from '../../../../../lib/helpers/constants';
import { encodeExitStablePool, encodeJoinStablePool } from '../../../../../lib/helpers/stablePoolEncoding';

import * as expectEvent from '../../../expectEvent';
import Vault from '../../vault/Vault';
import Token from '../../tokens/Token';
import TokenList from '../../tokens/TokenList';
import TypesConverter from '../../types/TypesConverter';
import StablePoolDeployer from './StablePoolDeployer';
import { Account } from '../../types/types';
import {
  JoinExitStablePool,
  InitStablePool,
  JoinGivenInStablePool,
  JoinGivenOutStablePool,
  JoinResult,
  RawStablePoolDeployment,
  ExitResult,
  SingleExitGivenInStablePool,
  MultiExitGivenInStablePool,
  ExitGivenOutStablePool,
  SwapStablePool,
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
} from '../../../math/stable';

const SWAP_GIVEN = { IN: 0, OUT: 1 };

export default class StablePool {
  instance: Contract;
  poolId: string;
  tokens: TokenList;
  swapFee: BigNumberish;
  amplificationParameter: BigNumberish;
  vault: Vault;

  static async create(params: RawStablePoolDeployment = {}): Promise<StablePool> {
    return StablePoolDeployer.deploy(params);
  }

  constructor(
    instance: Contract,
    poolId: string,
    vault: Vault,
    tokens: TokenList,
    amplificationParameter: BigNumberish,
    swapFee: BigNumberish
  ) {
    this.instance = instance;
    this.poolId = poolId;
    this.vault = vault;
    this.tokens = tokens;
    this.amplificationParameter = amplificationParameter;
    this.swapFee = swapFee;
  }

  get address(): string {
    return this.instance.address;
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

  async getSwapFee(): Promise<BigNumber> {
    return this.instance.getSwapFeePercentage();
  }

  async getAmplificationParameter(): Promise<BigNumber> {
    return this.instance.getAmplificationParameter();
  }

  async getTokens(): Promise<{ tokens: string[]; balances: BigNumber[]; maxBlockNumber: BigNumber }> {
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

    return calculateInvariant(currentBalances, this.amplificationParameter);
  }

  async estimateSwapFee(
    paidToken: number | Token,
    protocolFeePercentage: BigNumberish,
    currentBalances?: BigNumberish[]
  ): Promise<BigNumber> {
    if (!currentBalances) currentBalances = await this.getBalances();
    const lastInvariant = await this.estimateInvariant();
    const paidTokenIndex = this.tokens.indexOf(paidToken);
    const feeAmount = calculateOneTokenSwapFee(
      currentBalances,
      this.amplificationParameter,
      lastInvariant,
      paidTokenIndex
    );

    return bn(feeAmount).mul(protocolFeePercentage).div(fp(1));
  }

  async estimateGivenIn(params: SwapStablePool, currentBalances?: BigNumberish[]): Promise<BigNumberish> {
    if (!currentBalances) currentBalances = await this.getBalances();
    const [tokenIn, tokenOut] = this.tokens.indicesOf(params.in, params.out);

    return bn(calcOutGivenIn(currentBalances, this.amplificationParameter, tokenIn, tokenOut, params.amount));
  }

  async estimateGivenOut(params: SwapStablePool, currentBalances?: BigNumberish[]): Promise<BigNumberish> {
    if (!currentBalances) currentBalances = await this.getBalances();
    const [tokenIn, tokenOut] = this.tokens.indicesOf(params.in, params.out);

    return bn(calcInGivenOut(currentBalances, this.amplificationParameter, tokenIn, tokenOut, params.amount));
  }

  async estimateBptOut(
    amountsIn: BigNumberish[],
    currentBalances?: BigNumberish[],
    supply?: BigNumberish
  ): Promise<BigNumberish> {
    if (!supply) supply = await this.totalSupply();
    if (!currentBalances) currentBalances = await this.getBalances();

    return calcBptOutGivenExactTokensIn(currentBalances, this.amplificationParameter, amountsIn, supply, this.swapFee);
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
      this.amplificationParameter,
      bptOut,
      supply,
      this.swapFee
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
      this.amplificationParameter,
      bptIn,
      supply,
      this.swapFee
    );
  }

  async swapGivenIn(params: SwapStablePool): Promise<BigNumber> {
    const currentBalances = await this.getBalances();
    const [tokenIn, tokenOut] = this.tokens.indicesOf(params.in, params.out);

    return this.instance.callStatic.onSwap(
      {
        kind: SWAP_GIVEN.IN,
        poolId: this.poolId,
        from: params.from ?? ZERO_ADDRESS,
        to: params.recipient ?? ZERO_ADDRESS,
        tokenIn: params.in < this.tokens.length ? this.tokens.get(params.in)?.address ?? ZERO_ADDRESS : ZERO_ADDRESS,
        tokenOut: params.out < this.tokens.length ? this.tokens.get(params.out)?.address ?? ZERO_ADDRESS : ZERO_ADDRESS,
        latestBlockNumberUsed: params.latestBlockNumberUsed ?? 0,
        userData: params.data ?? '0x',
        amount: params.amount,
      },
      currentBalances,
      tokenIn,
      tokenOut
    );
  }

  async swapGivenOut(params: SwapStablePool): Promise<BigNumber> {
    const currentBalances = await this.getBalances();
    const [tokenIn, tokenOut] = this.tokens.indicesOf(params.in, params.out);

    return this.instance.callStatic.onSwap(
      {
        kind: SWAP_GIVEN.OUT,
        poolId: this.poolId,
        from: params.from ?? ZERO_ADDRESS,
        to: params.recipient ?? ZERO_ADDRESS,
        tokenIn: params.in < this.tokens.length ? this.tokens.get(params.in)?.address ?? ZERO_ADDRESS : ZERO_ADDRESS,
        tokenOut: params.out < this.tokens.length ? this.tokens.get(params.out)?.address ?? ZERO_ADDRESS : ZERO_ADDRESS,
        latestBlockNumberUsed: params.latestBlockNumberUsed ?? 0,
        userData: params.data ?? '0x',
        amount: params.amount,
      },
      currentBalances,
      tokenIn,
      tokenOut
    );
  }

  async init(params: InitStablePool): Promise<JoinResult> {
    return this.join(this._buildInitParams(params));
  }

  async joinGivenIn(params: JoinGivenInStablePool): Promise<JoinResult> {
    return this.join(this._buildJoinGivenInParams(params));
  }

  async queryJoinGivenIn(params: JoinGivenInStablePool): Promise<JoinQueryResult> {
    return this.queryJoin(this._buildJoinGivenInParams(params));
  }

  async joinGivenOut(params: JoinGivenOutStablePool): Promise<JoinResult> {
    return this.join(this._buildJoinGivenOutParams(params));
  }

  async queryJoinGivenOut(params: JoinGivenOutStablePool): Promise<JoinQueryResult> {
    return this.queryJoin(this._buildJoinGivenOutParams(params));
  }

  async exitGivenOut(params: ExitGivenOutStablePool): Promise<ExitResult> {
    return this.exit(this._buildExitGivenOutParams(params));
  }

  async queryExitGivenOut(params: ExitGivenOutStablePool): Promise<ExitQueryResult> {
    return this.queryExit(this._buildExitGivenOutParams(params));
  }

  async singleExitGivenIn(params: SingleExitGivenInStablePool): Promise<ExitResult> {
    return this.exit(this._buildSingleExitGivenInParams(params));
  }

  async querySingleExitGivenIn(params: SingleExitGivenInStablePool): Promise<ExitQueryResult> {
    return this.queryExit(this._buildSingleExitGivenInParams(params));
  }

  async multiExitGivenIn(params: MultiExitGivenInStablePool): Promise<ExitResult> {
    return this.exit(this._buildMultiExitGivenInParams(params));
  }

  async queryMultiExitGivenIn(params: MultiExitGivenInStablePool): Promise<ExitQueryResult> {
    return this.queryExit(this._buildMultiExitGivenInParams(params));
  }

  async queryJoin(params: JoinExitStablePool): Promise<JoinQueryResult> {
    const fn = this.instance.callStatic.queryJoin;
    return (await this._executeQuery(params, fn)) as JoinQueryResult;
  }

  async join(params: JoinExitStablePool): Promise<JoinResult> {
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

  async queryExit(params: JoinExitStablePool): Promise<ExitQueryResult> {
    const fn = this.instance.callStatic.queryExit;
    return (await this._executeQuery(params, fn)) as ExitQueryResult;
  }

  async exit(params: JoinExitStablePool): Promise<ExitResult> {
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

  private async _executeQuery(params: JoinExitStablePool, fn: ContractFunction): Promise<PoolQueryResult> {
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

  private _buildInitParams(params: InitStablePool): JoinExitStablePool {
    const { initialBalances: balances } = params;
    const amountsIn = Array.isArray(balances) ? balances : Array(this.tokens.length).fill(balances);

    return {
      from: params.from,
      recipient: params.recipient,
      protocolFeePercentage: params.protocolFeePercentage,
      data: encodeJoinStablePool({
        kind: 'Init',
        amountsIn,
      }),
    };
  }

  private _buildJoinGivenInParams(params: JoinGivenInStablePool): JoinExitStablePool {
    const { amountsIn: amounts } = params;
    const amountsIn = Array.isArray(amounts) ? amounts : Array(this.tokens.length).fill(amounts);

    return {
      from: params.from,
      recipient: params.recipient,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: encodeJoinStablePool({
        kind: 'ExactTokensInForBPTOut',
        amountsIn,
        minimumBPT: params.minimumBptOut ?? 0,
      }),
    };
  }

  private _buildJoinGivenOutParams(params: JoinGivenOutStablePool): JoinExitStablePool {
    return {
      from: params.from,
      recipient: params.recipient,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: encodeJoinStablePool({
        kind: 'TokenInForExactBPTOut',
        bptAmountOut: params.bptOut,
        enterTokenIndex: this.tokens.indexOf(params.token),
      }),
    };
  }

  private _buildExitGivenOutParams(params: ExitGivenOutStablePool): JoinExitStablePool {
    const { amountsOut: amounts } = params;
    const amountsOut = Array.isArray(amounts) ? amounts : Array(this.tokens.length).fill(amounts);
    return {
      from: params.from,
      recipient: params.recipient,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: encodeExitStablePool({
        kind: 'BPTInForExactTokensOut',
        amountsOut,
        maxBPTAmountIn: params.maximumBptIn ?? MAX_UINT256,
      }),
    };
  }

  private _buildSingleExitGivenInParams(params: SingleExitGivenInStablePool): JoinExitStablePool {
    return {
      from: params.from,
      recipient: params.recipient,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: encodeExitStablePool({
        kind: 'ExactBPTInForOneTokenOut',
        bptAmountIn: params.bptIn,
        exitTokenIndex: this.tokens.indexOf(params.token),
      }),
    };
  }

  private _buildMultiExitGivenInParams(params: MultiExitGivenInStablePool): JoinExitStablePool {
    return {
      from: params.from,
      recipient: params.recipient,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: encodeExitStablePool({
        kind: 'ExactBPTInForTokensOut',
        bptAmountIn: params.bptIn,
      }),
    };
  }

  async activateEmergencyPeriod(): Promise<void> {
    const role = roleId(this.instance, 'setEmergencyPeriod');
    await this.vault.grantRole(role);
    await this.instance.setEmergencyPeriod(true);
  }
}
