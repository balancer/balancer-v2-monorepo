import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractTransaction, ContractReceipt, ContractFunction } from 'ethers';

import { BatchSwapStep, FundManagement, SwapKind } from '@balancer-labs/balancer-js';
import { BigNumberish, bn } from '@balancer-labs/v2-helpers/src/numbers';
import { StablePoolEncoder } from '@balancer-labs/balancer-js/src';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { Account, NAry, TxParams } from '../../types/types';
import { MAX_UINT112, ZERO_ADDRESS, MAX_UINT256 } from '../../../constants';
import { GeneralSwap, QueryBatchSwap } from '../../vault/types';
import { RawStablePhantomPoolDeployment, SwapPhantomPool } from './types';

import Vault from '../../vault/Vault';
import Token from '../../tokens/Token';
import TokenList from '../../tokens/TokenList';
import TypesConverter from '../../types/TypesConverter';
import StablePhantomPoolDeployer from './StablePhantomPoolDeployer';
import * as expectEvent from '../../../test/expectEvent';

import {
  InitStablePool,
  JoinGivenInStablePool,
  JoinGivenOutStablePool,
  JoinExitStablePool,
  JoinResult,
  JoinQueryResult,
  ExitGivenOutStablePool,
  SingleExitGivenInStablePool,
  ExitResult,
  ExitQueryResult,
  PoolQueryResult,
} from '../stable-phantom/types';
import {
  calcBptInGivenExactTokensOut,
  calcBptOutGivenExactTokensIn,
  calcInGivenOut,
  calcOutGivenIn,
  calcTokenInGivenExactBptOut,
  calcTokenOutGivenExactBptIn,
  calculateInvariant,
} from '../stable-phantom/math';
import BasePool from '../base/BasePool';
import { currentTimestamp, DAY } from '../../../time';

const PREMINTED_BPT = MAX_UINT112.div(2);

export default class StablePhantomPool extends BasePool {
  amplificationParameter: BigNumberish;
  bptIndex: number;

  static async create(params: RawStablePhantomPoolDeployment = {}): Promise<StablePhantomPool> {
    return StablePhantomPoolDeployer.deploy(params);
  }

  constructor(
    instance: Contract,
    poolId: string,
    vault: Vault,
    tokens: TokenList,
    bptIndex: BigNumber,
    swapFeePercentage: BigNumberish,
    amplificationParameter: BigNumberish,
    owner?: SignerWithAddress
  ) {
    super(instance, poolId, vault, tokens, swapFeePercentage, owner);

    this.amplificationParameter = amplificationParameter;
    this.bptIndex = bptIndex.toNumber();
  }

  get bpt(): Token {
    return new Token('BPT', 'BPT', 18, this.instance);
  }

  async virtualTotalSupply(): Promise<BigNumber> {
    return PREMINTED_BPT.sub((await this.getBalances())[this.bptIndex]);
  }

  async getTokenIndex(token: Token): Promise<number> {
    return (await this.getTokens()).tokens.indexOf(token.address);
  }

  async getBalances(): Promise<BigNumber[]> {
    return (await this.getTokens()).balances;
  }

  async getDueProtocolFeeBptAmount(): Promise<BigNumber> {
    return this.instance.getDueProtocolFeeBptAmount();
  }

  async getAmplificationParameter(): Promise<{ value: BigNumber; isUpdating: boolean; precision: BigNumber }> {
    return this.instance.getAmplificationParameter();
  }

  async getBptIndex(): Promise<number> {
    return (await this.instance.getBptIndex()).toNumber();
  }

  async getRateProviders(): Promise<string[]> {
    return this.instance.getRateProviders();
  }

  async getTokenRateCache(token: Account): Promise<{ expires: BigNumber; rate: BigNumber; duration: BigNumber }> {
    return this.instance.getTokenRateCache(typeof token === 'string' ? token : token.address);
  }

  async getRate(): Promise<BigNumber> {
    return this.instance.getRate();
  }

  async getVirtualSupply(): Promise<BigNumber> {
    return this.instance.getVirtualSupply();
  }

  async updateTokenRateCache(token: Token): Promise<ContractTransaction> {
    return this.instance.updateTokenRateCache(token.address);
  }

  async getProtocolSwapFeePercentageCache(): Promise<BigNumber> {
    return this.instance.getProtocolSwapFeePercentageCache();
  }

  async updateProtocolSwapFeePercentageCache(): Promise<ContractTransaction> {
    return this.instance.updateProtocolSwapFeePercentageCache();
  }

  async setTokenRateCacheDuration(token: Token, duration: BigNumber, params?: TxParams): Promise<ContractTransaction> {
    const pool = params?.from ? this.instance.connect(params.from) : this.instance;
    return pool.setTokenRateCacheDuration(token.address, duration);
  }

  async startAmpChange(
    newAmp: BigNumberish,
    endTime?: BigNumberish,
    txParams: TxParams = {}
  ): Promise<ContractTransaction> {
    const sender = txParams.from || this.owner;
    const pool = sender ? this.instance.connect(sender) : this.instance;
    if (!endTime) endTime = (await currentTimestamp()).add(2 * DAY);
    return pool.startAmplificationParameterUpdate(newAmp, endTime);
  }

  async stopAmpChange(txParams: TxParams = {}): Promise<ContractTransaction> {
    const sender = txParams.from || this.owner;
    const pool = sender ? this.instance.connect(sender) : this.instance;
    return pool.stopAmplificationParameterUpdate();
  }

  async estimateInvariant(currentBalances?: BigNumberish[]): Promise<BigNumber> {
    if (!currentBalances) currentBalances = await this.getBalances();
    return calculateInvariant(await this._dropBptItem(currentBalances), this.amplificationParameter);
  }

  async estimateTokenOutGivenTokenIn(tokenIn: Token, tokenOut: Token, amountIn: BigNumberish): Promise<BigNumberish> {
    const indexIn = this._skipBptIndex(await this.getTokenIndex(tokenIn));
    const indexOut = this._skipBptIndex(await this.getTokenIndex(tokenOut));
    const currentBalances = await this._dropBptItem(await this.getBalances());
    return bn(calcOutGivenIn(currentBalances, this.amplificationParameter, indexIn, indexOut, amountIn));
  }

  async estimateTokenInGivenTokenOut(tokenIn: Token, tokenOut: Token, amountOut: BigNumberish): Promise<BigNumberish> {
    const indexIn = this._skipBptIndex(await this.getTokenIndex(tokenIn));
    const indexOut = this._skipBptIndex(await this.getTokenIndex(tokenOut));
    const currentBalances = await this._dropBptItem(await this.getBalances());
    return bn(calcInGivenOut(currentBalances, this.amplificationParameter, indexIn, indexOut, amountOut));
  }

  async estimateTokenOutGivenBptIn(token: Token, bptIn: BigNumberish): Promise<BigNumberish> {
    const tokenIndex = this._skipBptIndex(await this.getTokenIndex(token));
    const virtualSupply = await this.virtualTotalSupply();
    const currentBalances = await this._dropBptItem(await this.getBalances());

    return calcTokenOutGivenExactBptIn(
      tokenIndex,
      currentBalances,
      this.amplificationParameter,
      bptIn,
      virtualSupply,
      0
    );
  }

  async estimateTokenInGivenBptOut(token: Token, bptOut: BigNumberish): Promise<BigNumberish> {
    const tokenIndex = this._skipBptIndex(await this.getTokenIndex(token));
    const virtualSupply = await this.virtualTotalSupply();
    const currentBalances = await this._dropBptItem(await this.getBalances());

    return calcTokenInGivenExactBptOut(
      tokenIndex,
      currentBalances,
      this.amplificationParameter,
      bptOut,
      virtualSupply,
      0
    );
  }

  async estimateBptOutGivenTokenIn(token: Token, amountIn: BigNumberish): Promise<BigNumberish> {
    const tokenIndex = this._skipBptIndex(await this.getTokenIndex(token));
    const virtualSupply = await this.virtualTotalSupply();
    const currentBalances = await this._dropBptItem(await this.getBalances());
    const amountsIn = Array.from({ length: currentBalances.length }, (_, i) => (i == tokenIndex ? amountIn : 0));

    return calcBptOutGivenExactTokensIn(currentBalances, this.amplificationParameter, amountsIn, virtualSupply, 0);
  }

  async estimateBptInGivenTokenOut(token: Token, amountOut: BigNumberish): Promise<BigNumberish> {
    const tokenIndex = this._skipBptIndex(await this.getTokenIndex(token));
    const virtualSupply = await this.virtualTotalSupply();
    const currentBalances = await this._dropBptItem(await this.getBalances());
    const amountsOut = Array.from({ length: currentBalances.length }, (_, i) => (i == tokenIndex ? amountOut : 0));

    return calcBptInGivenExactTokensOut(currentBalances, this.amplificationParameter, amountsOut, virtualSupply, 0);
  }

  async estimateBptOut(
    amountsIn: BigNumberish[],
    currentBalances?: BigNumberish[],
    supply?: BigNumberish
  ): Promise<BigNumberish> {
    if (!supply) supply = await this.virtualTotalSupply();
    if (!currentBalances) currentBalances = await this._dropBptItem(await this.getBalances());
    const swapFeePercentage = await this.getSwapFeePercentage();

    const tokenCountWithBpt = (await this.getBalances()).length;

    if (currentBalances.length == tokenCountWithBpt) {
      currentBalances = await this._dropBptItem(currentBalances);
    }
    if (amountsIn.length == tokenCountWithBpt) {
      amountsIn = await this._dropBptItem(amountsIn);
    }

    return calcBptOutGivenExactTokensIn(
      currentBalances,
      this.amplificationParameter,
      amountsIn,
      supply,
      swapFeePercentage
    );
  }

  async swapGivenIn(params: SwapPhantomPool): Promise<{ amountOut: BigNumber; receipt: ContractReceipt }> {
    const { amountOut, receipt } = await this.swap(await this._buildSwapParams(SwapKind.GivenIn, params));
    return { amountOut, receipt };
  }

  async swapGivenOut(params: SwapPhantomPool): Promise<{ amountIn: BigNumber; receipt: ContractReceipt }> {
    const { amountIn, receipt } = await this.swap(await this._buildSwapParams(SwapKind.GivenOut, params));
    return { amountIn, receipt };
  }

  async swap(params: GeneralSwap): Promise<{ amountIn: BigNumber; amountOut: BigNumber; receipt: ContractReceipt }> {
    const tx = await this.vault.generalSwap(params);
    const receipt = await tx.wait();
    const args = expectEvent.inReceipt(receipt, 'Swap').args;
    return {
      amountIn: args.amountIn,
      amountOut: args.amountOut,
      receipt,
    };
  }

  async init(initParams: InitStablePool): Promise<JoinResult> {
    const from = initParams.from || (await ethers.getSigners())[0];
    const initialBalances = initParams.initialBalances;
    const balances = await this._dropBptItem(Array.isArray(initialBalances) ? initialBalances : [initialBalances]);

    await Promise.all(
      balances.map(async (balance, i) => {
        const token = this.tokens.get(i);

        await token.mint(from, balance);
        await token.approve(this.vault, balance, { from });
      })
    );

    const { tokens: allTokens } = await this.getTokens();
    const params: JoinExitStablePool = this._buildInitParams(initParams);
    const currentBalances = params.currentBalances || (await this.getBalances());
    const to = params.recipient ? TypesConverter.toAddress(params.recipient) : params.from?.address ?? ZERO_ADDRESS;

    const tx = this.vault.joinPool({
      poolAddress: this.address,
      poolId: this.poolId,
      recipient: to,
      currentBalances,
      tokens: allTokens,
      lastChangeBlock: params.lastChangeBlock ?? 0,
      protocolFeePercentage: params.protocolFeePercentage ?? 0,
      data: params.data ?? '0x',
      from: params.from,
    });

    const receipt = await (await tx).wait();
    const { deltas, protocolFeeAmounts } = expectEvent.inReceipt(receipt, 'PoolBalanceChanged').args;
    return { amountsIn: deltas, dueProtocolFeeAmounts: protocolFeeAmounts };
  }

  toList<T>(items: NAry<T>): T[] {
    return Array.isArray(items) ? items : [items];
  }

  async joinGivenIn(params: JoinGivenInStablePool): Promise<JoinResult> {
    // Need to drop BPT from amountsIn
    const tokenAmountsIn = this.toList(params.amountsIn);

    params.amountsIn = await this._dropBptItem(tokenAmountsIn);

    return this.join(this._buildJoinGivenInParams(params));
  }

  async queryJoinGivenIn(params: JoinGivenInStablePool): Promise<JoinQueryResult> {
    // Need to drop BPT from amountsIn
    const tokenAmountsIn = this.toList(params.amountsIn);

    params.amountsIn = await this._dropBptItem(tokenAmountsIn);

    return this.queryJoin(this._buildJoinGivenInParams(params));
  }

  async joinGivenOut(params: JoinGivenOutStablePool): Promise<JoinResult> {
    return this.join(this._buildJoinGivenOutParams(params));
  }

  async queryJoinGivenOut(params: JoinGivenOutStablePool): Promise<JoinQueryResult> {
    return this.queryJoin(this._buildJoinGivenOutParams(params));
  }

  async join(params: JoinExitStablePool): Promise<JoinResult> {
    const currentBalances = params.currentBalances || (await this.getBalances());
    const to = params.recipient ? TypesConverter.toAddress(params.recipient) : params.from?.address ?? ZERO_ADDRESS;
    const { tokens: allTokens } = await this.getTokens();

    const tx = this.vault.joinPool({
      poolAddress: this.address,
      poolId: this.poolId,
      recipient: to,
      currentBalances,
      tokens: allTokens,
      lastChangeBlock: params.lastChangeBlock ?? 0,
      protocolFeePercentage: params.protocolFeePercentage ?? 0,
      data: params.data ?? '0x',
      from: params.from,
    });

    const receipt = await (await tx).wait();
    const { deltas, protocolFees } = expectEvent.inReceipt(receipt, 'PoolBalanceChanged').args;
    return { amountsIn: deltas, dueProtocolFeeAmounts: protocolFees };
  }

  async queryJoin(params: JoinExitStablePool): Promise<JoinQueryResult> {
    const fn = this.instance.queryJoin;
    return (await this._executeQuery(params, fn)) as JoinQueryResult;
  }

  async exitGivenOut(params: ExitGivenOutStablePool): Promise<ExitResult> {
    // Need to drop BPT from amountsOut
    const tokenAmountsOut = this.toList(params.amountsOut);
    params.amountsOut = await this._dropBptItem(tokenAmountsOut);

    return this.exit(this._buildExitGivenOutParams(params));
  }

  async queryExitGivenOut(params: ExitGivenOutStablePool): Promise<ExitQueryResult> {
    // Need to drop BPT from amountsOut
    const tokenAmountsOut = this.toList(params.amountsOut);
    params.amountsOut = await this._dropBptItem(tokenAmountsOut);

    return this.queryExit(this._buildExitGivenOutParams(params));
  }

  async singleExitGivenIn(params: SingleExitGivenInStablePool): Promise<ExitResult> {
    return this.exit(this._buildSingleExitGivenInParams(params));
  }

  async querySingleExitGivenIn(params: SingleExitGivenInStablePool): Promise<ExitQueryResult> {
    return this.queryExit(this._buildSingleExitGivenInParams(params));
  }

  async queryExit(params: JoinExitStablePool): Promise<ExitQueryResult> {
    const fn = this.instance.queryExit;
    return (await this._executeQuery(params, fn)) as ExitQueryResult;
  }

  private async _buildSwapParams(kind: number, params: SwapPhantomPool): Promise<GeneralSwap> {
    return {
      kind,
      poolAddress: this.address,
      poolId: this.poolId,
      from: params.from,
      to: TypesConverter.toAddress(params.recipient),
      tokenIn: params.in.address || ZERO_ADDRESS,
      tokenOut: params.out.address || ZERO_ADDRESS,
      lastChangeBlock: params.lastChangeBlock ?? 0,
      data: params.data ?? '0x',
      amount: params.amount,
      balances: params.balances || (await this.getTokens()).balances,
      indexIn: await this.getTokenIndex(params.in),
      indexOut: await this.getTokenIndex(params.out),
    };
  }

  private _buildInitParams(params: InitStablePool): JoinExitStablePool {
    const { initialBalances: balances } = params;
    const amountsIn = Array.isArray(balances) ? balances : Array(this.tokens.length).fill(balances);

    return {
      from: params.from,
      recipient: params.recipient,
      protocolFeePercentage: params.protocolFeePercentage,
      data: StablePoolEncoder.joinInit(amountsIn),
    };
  }

  private _buildJoinGivenInParams(params: JoinGivenInStablePool): JoinExitStablePool {
    const { amountsIn: amounts } = params;
    const amountsIn = Array.isArray(amounts) ? amounts : Array(this.tokens.length).fill(amounts);

    return {
      from: params.from,
      recipient: params.recipient,
      lastChangeBlock: params.lastChangeBlock,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: StablePoolEncoder.joinExactTokensInForBPTOut(amountsIn, params.minimumBptOut ?? 0),
    };
  }

  private _buildJoinGivenOutParams(params: JoinGivenOutStablePool): JoinExitStablePool {
    return {
      from: params.from,
      recipient: params.recipient,
      lastChangeBlock: params.lastChangeBlock,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: StablePoolEncoder.joinTokenInForExactBPTOut(params.bptOut, this.tokens.indexOf(params.token)),
    };
  }

  private _buildExitGivenOutParams(params: ExitGivenOutStablePool): JoinExitStablePool {
    const { amountsOut: amounts } = params;
    const amountsOut = Array.isArray(amounts) ? amounts : Array(this.tokens.length).fill(amounts);

    return {
      from: params.from,
      recipient: params.recipient,
      lastChangeBlock: params.lastChangeBlock,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: StablePoolEncoder.exitBPTInForExactTokensOut(amountsOut, params.maximumBptIn ?? MAX_UINT256),
    };
  }

  private _buildSingleExitGivenInParams(params: SingleExitGivenInStablePool): JoinExitStablePool {
    return {
      from: params.from,
      recipient: params.recipient,
      lastChangeBlock: params.lastChangeBlock,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: StablePoolEncoder.exitExactBPTInForOneTokenOut(params.bptIn, this.tokens.indexOf(params.token)),
    };
  }

  private _buildQuerySwapParams(kind: number, allTokens: string[], params: SwapPhantomPool): QueryBatchSwap {
    const swapStep: BatchSwapStep = {
      poolId: this.poolId,
      assetInIndex: allTokens.indexOf(params.in.address),
      assetOutIndex: allTokens.indexOf(params.out.address),
      amount: params.amount,
      userData: '0x',
    };

    const funds: FundManagement = {
      sender: params.from?.address ?? ZERO_ADDRESS,
      fromInternalBalance: false,
      recipient: TypesConverter.toAddress(params.recipient) ?? ZERO_ADDRESS,
      toInternalBalance: false,
    };

    return {
      kind,
      swaps: [swapStep],
      assets: allTokens,
      funds,
    };
  }

  async querySwapGivenIn(params: SwapPhantomPool): Promise<BigNumber> {
    const { tokens: allTokens } = await this.getTokens();

    const amountsOut = await this._querySwapInternal(SwapKind.GivenIn, params, allTokens);
    return amountsOut[allTokens.indexOf(params.out.address)].mul(-1);
  }

  async querySwapGivenOut(params: SwapPhantomPool): Promise<BigNumber> {
    const { tokens: allTokens } = await this.getTokens();

    const amountsIn = await this._querySwapInternal(SwapKind.GivenOut, params, allTokens);
    return amountsIn[allTokens.indexOf(params.in.address)];
  }

  private async _querySwapInternal(kind: SwapKind, params: SwapPhantomPool, allTokens: string[]): Promise<BigNumber[]> {
    const queryParams = this._buildQuerySwapParams(kind, allTokens, params);

    return await this.vault.queryBatchSwap(queryParams);
  }

  private async _executeQuery(params: JoinExitStablePool, fn: ContractFunction): Promise<PoolQueryResult> {
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

  private _skipBptIndex(index: number): number {
    return index < this.bptIndex ? index : index - 1;
  }

  private async _dropBptItem(items: BigNumberish[]): Promise<BigNumberish[]> {
    const result = [];
    for (let i = 0; i < items.length - 1; i++) result[i] = items[i < this.bptIndex ? i : i + 1];
    return result;
  }
}
