import { BigNumber, Contract } from 'ethers';
import { SwapKind } from '@balancer-labs/balancer-js';
import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { Account } from '../../types/types';
import { ZERO_ADDRESS } from '../../../constants';
import { GeneralSwap } from '../../vault/types';
import { RawStablePhantomPoolDeployment, SwapPhantomPool } from './types';

import Vault from '../../vault/Vault';
import TokenList from '../../tokens/TokenList';
import TypesConverter from '../../types/TypesConverter';
import StablePhantomPoolDeployer from './StablePhantomPoolDeployer';
import * as expectEvent from '../../../test/expectEvent';

import { calculateInvariant } from "../stable/math";
import { InitStablePool, JoinExitStablePool, JoinResult } from "../stable/types";
import { StablePoolEncoder } from '@balancer-labs/balancer-js/src';
import { actionId } from "../../misc/actions";

export default class StablePhantomPool {
  instance: Contract;
  poolId: string;
  vault: Vault;
  tokens: TokenList;
  swapFeePercentage: BigNumberish;
  amplificationParameter: BigNumberish;
  owner?: SignerWithAddress;

  static async create(params: RawStablePhantomPoolDeployment = {}): Promise<StablePhantomPool> {
    return StablePhantomPoolDeployer.deploy(params);
  }

  constructor(
    instance: Contract,
    poolId: string,
    vault: Vault,
    tokens: TokenList,
    swapFeePercentage: BigNumberish,
    amplificationParameter: BigNumberish,
    owner?: SignerWithAddress
  ) {
    this.instance = instance;
    this.poolId = poolId;
    this.vault = vault;
    this.tokens = tokens;
    this.swapFeePercentage = swapFeePercentage;
    this.amplificationParameter = amplificationParameter;
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

  async decimals(): Promise<number> {
    return this.instance.decimals();
  }

  async totalSupply(): Promise<BigNumber> {
    return this.instance.totalSupply();
  }

  async balanceOf(account: Account): Promise<BigNumber> {
    return this.instance.balanceOf(TypesConverter.toAddress(account));
  }

  async getRegisteredInfo(): Promise<{ address: string; specialization: BigNumber }> {
    return this.vault.getPool(this.poolId);
  }

  async getTokens(): Promise<{ tokens: string[]; balances: BigNumber[]; lastChangeBlock: BigNumber }> {
    return this.vault.getPoolTokens(this.poolId);
  }

  async getBalances(): Promise<BigNumber[]> {
    return (await this.getTokens()).balances;
  }

  async getVault(): Promise<string> {
    return this.instance.getVault();
  }

  async getOwner(): Promise<string> {
    return this.instance.getOwner();
  }

  async getPoolId(): Promise<string> {
    return this.instance.getPoolId();
  }

  async getSwapFeePercentage(): Promise<BigNumber> {
    return this.instance.getSwapFeePercentage();
  }

  async getAmplificationParameter(): Promise<{ value: BigNumber; isUpdating: boolean; precision: BigNumber }> {
    return this.instance.getAmplificationParameter();
  }

  async getBptIndex(): Promise<number> {
    return (await this.instance.getBptIndex()).toNumber();
  }

  async getScalingFactors(): Promise<BigNumber[]> {
    return this.instance.getScalingFactors();
  }

  async getRateProviders(): Promise<string> {
    return this.instance.getRateProviders();
  }

  async getPriceRateCache(token: Account): Promise<{ expires: BigNumber; rate: BigNumber; duration: BigNumber }> {
    return this.instance.getPriceRateCache(typeof token === 'string' ? token : token.address);
  }

  async pause(): Promise<void> {
    const action = await actionId(this.instance, 'setPaused');
    await this.vault.grantRole(action);
    await this.instance.setPaused(true);
  }

  async estimateInvariant(currentBalances?: BigNumberish[]): Promise<BigNumber> {
    if (!currentBalances) currentBalances = await this.getBalances();
    return calculateInvariant(await this._dropBptItem(currentBalances), this.amplificationParameter);
  }

  async swapGivenIn(params: SwapPhantomPool): Promise<BigNumber> {
    return this.swap(await this._buildSwapParams(SwapKind.GivenIn, params));
  }

  async swapGivenOut(params: SwapPhantomPool): Promise<BigNumber> {
    return this.swap(await this._buildSwapParams(SwapKind.GivenOut, params));
  }

  async swap(params: GeneralSwap): Promise<BigNumber> {
    const tx = await this.vault.generalSwap(params);
    const { amount } = expectEvent.inReceipt(await tx.wait(), 'Swap').args;
    return amount;
  }

  async init(initParams: InitStablePool): Promise<JoinResult> {
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
    const { deltas, protocolFees } = expectEvent.inReceipt(receipt, 'PoolBalanceChanged').args;
    return { amountsIn: deltas, dueProtocolFeeAmounts: protocolFees };
  }

  private async _buildSwapParams(kind: number, params: SwapPhantomPool): Promise<GeneralSwap> {
    const { tokens: allTokens } = await this.getTokens();
    return {
      kind,
      poolAddress: this.address,
      poolId: this.poolId,
      from: params.from,
      to: TypesConverter.toAddress(params.recipient),
      tokenIn: params.in < allTokens.length ? allTokens[params.in] : ZERO_ADDRESS,
      tokenOut: params.out < allTokens.length ? allTokens[params.out] : ZERO_ADDRESS,
      lastChangeBlock: params.lastChangeBlock ?? 0,
      data: params.data ?? '0x',
      amount: params.amount,
      balances: params.balances,
      indexIn: params.in,
      indexOut: params.out,
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

  private async _dropBptItem(items: BigNumberish[]): Promise<BigNumberish[]> {
    const bptIndex = await this.getBptIndex();
    const result = [];
    for (let i = 0; i < items.length - 1; i++) result[i] = items[i < bptIndex ? i : i + 1];
    return result;
  }
}
