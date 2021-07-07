import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, Contract, ContractFunction, ContractTransaction } from 'ethers';

import { actionId } from '../../misc/actions';
import { currentTimestamp, DAY } from '../../../time';
import { BigNumberish, bn, fp } from '../../../numbers';
import { MAX_UINT256, ZERO_ADDRESS } from '../../../constants';

import * as expectEvent from '../../../test/expectEvent';
import Vault from '../../vault/Vault';
import Token from '../../tokens/Token';
import TokenList from '../../tokens/TokenList';
import TypesConverter from '../../types/TypesConverter';
import StablePoolDeployer from './StablePoolDeployer';
import { Account, TxParams } from '../../types/types';
import { encodeExitStablePool, encodeJoinStablePool } from './encoding';
import {
  Sample,
  MiscData,
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
  calculateOneTokenSwapFeeAmount,
  calcInGivenOut,
  calculateSpotPrice,
  calculateBptPrice,
} from './math';

const SWAP_GIVEN = { IN: 0, OUT: 1 };

export enum SWAP_INTERFACE {
  DEFAULT,
  GENERAL,
  MINIMAL_SWAP_INFO,
}

export default class StablePool {
  instance: Contract;
  poolId: string;
  tokens: TokenList;
  swapFeePercentage: BigNumberish;
  amplificationParameter: BigNumberish;
  vault: Vault;
  meta: boolean;
  owner?: SignerWithAddress;

  static async create(params: RawStablePoolDeployment = {}): Promise<StablePool> {
    return StablePoolDeployer.deploy(params);
  }

  constructor(
    instance: Contract,
    poolId: string,
    vault: Vault,
    tokens: TokenList,
    amplificationParameter: BigNumberish,
    swapFeePercentage: BigNumberish,
    meta: boolean,
    owner?: SignerWithAddress
  ) {
    this.instance = instance;
    this.poolId = poolId;
    this.vault = vault;
    this.tokens = tokens;
    this.amplificationParameter = amplificationParameter;
    this.swapFeePercentage = swapFeePercentage;
    this.meta = meta;
    this.owner = owner;
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

  async getLastInvariant(): Promise<{ lastInvariant: BigNumber; lastInvariantAmp: BigNumber }> {
    return this.instance.getLastInvariant();
  }

  async getOracleMiscData(): Promise<MiscData> {
    if (!this.meta) throw Error('Cannot query misc data for non-meta stable pool');
    return this.instance.getOracleMiscData();
  }

  async getOracleSample(oracleIndex?: BigNumberish): Promise<Sample> {
    if (!oracleIndex) oracleIndex = (await this.getOracleMiscData()).oracleIndex;
    return this.instance.getSample(oracleIndex);
  }

  async isOracleEnabled(): Promise<boolean> {
    return (await this.getOracleMiscData()).oracleEnabled;
  }

  async getSwapFeePercentage(): Promise<BigNumber> {
    return this.instance.getSwapFeePercentage();
  }

  async getAmplificationParameter(): Promise<{ value: BigNumber; isUpdating: boolean; precision: BigNumber }> {
    return this.instance.getAmplificationParameter();
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

  async getRate(): Promise<BigNumber> {
    return this.instance.getRate();
  }

  async enableOracle(txParams: TxParams): Promise<void> {
    if (!this.meta) throw Error('Cannot enable oracle for non-meta stable pool');
    const pool = txParams.from ? this.instance.connect(txParams.from) : this.instance;
    await pool.enableOracle();
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

  async estimateSpotPrice(currentBalances?: BigNumberish[]): Promise<BigNumber> {
    if (!this.meta) throw Error('Spot price estimation is only available for meta stable pools');
    if (!currentBalances) currentBalances = await this.getBalances();
    return calculateSpotPrice(this.amplificationParameter, currentBalances);
  }

  async estimateBptPrice(currentBalances?: BigNumberish[], currentSupply?: BigNumberish): Promise<BigNumber> {
    if (!this.meta) throw Error('BPT price estimation is only available for meta stable pools');
    if (!currentBalances) currentBalances = await this.getBalances();
    if (!currentSupply) currentSupply = await this.totalSupply();
    return calculateBptPrice(this.amplificationParameter, currentBalances, currentSupply);
  }

  async estimateInvariant(currentBalances?: BigNumberish[]): Promise<BigNumber> {
    if (!currentBalances) currentBalances = await this.getBalances();

    return calculateInvariant(currentBalances, this.amplificationParameter);
  }

  async estimateSwapFeeAmount(
    paidToken: number | Token,
    protocolFeePercentage: BigNumberish,
    currentBalances?: BigNumberish[]
  ): Promise<BigNumber> {
    if (!currentBalances) currentBalances = await this.getBalances();
    const lastInvariant = await this.estimateInvariant();
    const paidTokenIndex = this.tokens.indexOf(paidToken);
    const feeAmount = calculateOneTokenSwapFeeAmount(
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

    return calcBptOutGivenExactTokensIn(
      currentBalances,
      this.amplificationParameter,
      amountsIn,
      supply,
      this.swapFeePercentage
    );
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
      this.amplificationParameter,
      bptIn,
      supply,
      this.swapFeePercentage
    );
  }

  async swapGivenIn(params: SwapStablePool, hookInterface = SWAP_INTERFACE.DEFAULT): Promise<BigNumber> {
    const swapRequest = this._buildSwapRequest(params, SWAP_GIVEN.IN);
    return this._callSwapHook(swapRequest, params.in, params.out, hookInterface);
  }

  async swapGivenOut(params: SwapStablePool, hookInterface = SWAP_INTERFACE.DEFAULT): Promise<BigNumber> {
    const swapRequest = this._buildSwapRequest(params, SWAP_GIVEN.OUT);
    return this._callSwapHook(swapRequest, params.in, params.out, hookInterface);
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
    const fn = this.instance.queryJoin;
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
      lastChangeBlock: params.lastChangeBlock ?? 0,
      protocolFeePercentage: params.protocolFeePercentage ?? 0,
      data: params.data ?? '0x',
      from: params.from,
    });

    const receipt = await (await tx).wait();
    const { deltas, protocolFees } = expectEvent.inReceipt(receipt, 'PoolBalanceChanged').args;
    return { amountsIn: deltas, dueProtocolFeeAmounts: protocolFees };
  }

  async queryExit(params: JoinExitStablePool): Promise<ExitQueryResult> {
    const fn = this.instance.queryExit;
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
      lastChangeBlock: params.lastChangeBlock ?? 0,
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
      params.lastChangeBlock ?? 0,
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
      lastChangeBlock: params.lastChangeBlock,
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
      lastChangeBlock: params.lastChangeBlock,
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
      lastChangeBlock: params.lastChangeBlock,
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
      lastChangeBlock: params.lastChangeBlock,
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
      lastChangeBlock: params.lastChangeBlock,
      currentBalances: params.currentBalances,
      protocolFeePercentage: params.protocolFeePercentage,
      data: encodeExitStablePool({
        kind: 'ExactBPTInForTokensOut',
        bptAmountIn: params.bptIn,
      }),
    };
  }

  private _buildSwapRequest(params: SwapStablePool, kind: number) {
    return {
      kind,
      poolId: this.poolId,
      from: params.from ?? ZERO_ADDRESS,
      to: params.recipient ?? ZERO_ADDRESS,
      tokenIn: params.in < this.tokens.length ? this.tokens.get(params.in)?.address ?? ZERO_ADDRESS : ZERO_ADDRESS,
      tokenOut: params.out < this.tokens.length ? this.tokens.get(params.out)?.address ?? ZERO_ADDRESS : ZERO_ADDRESS,
      lastChangeBlock: params.lastChangeBlock ?? 0,
      userData: params.data ?? '0x',
      amount: params.amount,
    };
  }

  private async _callSwapHook(
    swapRequest: unknown,
    tokenIn: number | Token,
    tokenOut: number | Token,
    hookInterface = SWAP_INTERFACE.DEFAULT
  ): Promise<BigNumber> {
    const [indexIn, indexOut] = this.tokens.indicesOf(tokenIn, tokenOut);
    const currentBalances = await this.getBalances();

    if (hookInterface == SWAP_INTERFACE.DEFAULT) {
      if (this.tokens.length > 2) {
        return this._callGeneralSwapHook(swapRequest, currentBalances, indexIn, indexOut);
      } else {
        return this._callMinimalSwapInfoSwapHook(swapRequest, currentBalances[indexIn], currentBalances[indexOut]);
      }
    } else if (hookInterface == SWAP_INTERFACE.MINIMAL_SWAP_INFO) {
      return this._callMinimalSwapInfoSwapHook(swapRequest, currentBalances[indexIn], currentBalances[indexOut]);
    } else {
      return this._callGeneralSwapHook(swapRequest, currentBalances, indexIn, indexOut);
    }
  }

  private _callMinimalSwapInfoSwapHook(
    swapRequest: unknown,
    currentBalanceTokenIn: BigNumber,
    currentBalanceTokenOut: BigNumber
  ): Promise<BigNumber> {
    return this.instance[
      'onSwap((uint8,address,address,uint256,bytes32,uint256,address,address,bytes),uint256,uint256)'
    ](swapRequest, currentBalanceTokenIn, currentBalanceTokenOut);
  }

  private _callGeneralSwapHook(
    swapRequest: unknown,
    currentBalances: BigNumber[],
    indexIn: number,
    indexOut: number
  ): Promise<BigNumber> {
    return this.instance[
      'onSwap((uint8,address,address,uint256,bytes32,uint256,address,address,bytes),uint256[],uint256,uint256)'
    ](swapRequest, currentBalances, indexIn, indexOut);
  }

  async pause(): Promise<void> {
    const action = await actionId(this.instance, 'setPaused');
    await this.vault.grantRole(action);
    await this.instance.setPaused(true);
  }
}
