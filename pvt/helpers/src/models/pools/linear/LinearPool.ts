import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, Contract, ContractTransaction } from 'ethers';

import { BigNumberish } from '../../../numbers';
import { ZERO_ADDRESS } from '../../../constants';

import * as expectEvent from '../../../test/expectEvent';
import Vault from '../../vault/Vault';
import Token from '../../tokens/Token';
import TypesConverter from '../../types/TypesConverter';
import LinearPoolDeployer from './LinearPoolDeployer';
import { Account, TxParams } from '../../types/types';

import { SwapKind } from '@balancer-labs/balancer-js';
import { SwapLinearPool, RawLinearPoolDeployment } from './types';
import TokenList from '../../tokens/TokenList';
import { GeneralSwap } from '../../vault/types';

export enum SWAP_INTERFACE {
  DEFAULT,
  GENERAL,
  MINIMAL_SWAP_INFO,
}

export default class LinearPool {
  instance: Contract;
  poolId: string;
  tokens: TokenList;
  lowerTarget: BigNumberish;
  upperTarget: BigNumberish;
  swapFeePercentage: BigNumberish;
  vault: Vault;
  owner?: SignerWithAddress;

  static async create(params: RawLinearPoolDeployment, mockedVault: boolean): Promise<LinearPool> {
    return LinearPoolDeployer.deploy(params, mockedVault);
  }

  constructor(
    instance: Contract,
    poolId: string,
    vault: Vault,
    tokens: TokenList,
    lowerTarget: BigNumberish,
    upperTarget: BigNumberish,
    swapFeePercentage: BigNumberish,
    owner?: SignerWithAddress
  ) {
    this.instance = instance;
    this.poolId = poolId;
    this.vault = vault;
    this.tokens = tokens;
    this.lowerTarget = lowerTarget;
    this.upperTarget = upperTarget;
    this.swapFeePercentage = swapFeePercentage;
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

  async getVault(): Promise<string> {
    return this.instance.getVault();
  }

  getVaultObject(): Vault {
    return this.vault;
  }

  async getRegisteredInfo(): Promise<{ address: string; specialization: BigNumber }> {
    return this.vault.getPool(this.poolId);
  }

  async getPoolId(): Promise<string> {
    return this.instance.getPoolId();
  }

  async getSwapFeePercentage(): Promise<BigNumber> {
    return this.instance.getSwapFeePercentage();
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

  async getBptTokenIndex(): Promise<number> {
    return this.getTokenIndex(this.address);
  }

  async getTokenIndex(address: string): Promise<number> {
    const { tokens } = await this.getTokens();
    return tokens[0] == address ? 0 : tokens[1] == address ? 1 : 2;
  }

  async getRate(): Promise<BigNumber> {
    return this.instance.getRate();
  }

  async getTargets(): Promise<{ lowerTarget: BigNumber; upperTarget: BigNumber }> {
    return this.instance.getTargets();
  }

  async setTargets(
    lowerTarget: BigNumber,
    upperTarget: BigNumber,
    txParams: TxParams = {}
  ): Promise<ContractTransaction> {
    const sender = txParams.from || this.owner;
    const pool = sender ? this.instance.connect(sender) : this.instance;
    return pool.setTargets(lowerTarget, upperTarget);
  }

  async initialize(): Promise<void> {
    return this.instance.initialize();
  }

  async swapGivenIn(params: SwapLinearPool): Promise<BigNumber> {
    return this.swap(this._buildSwapParams(SwapKind.GivenIn, params));
  }

  async swapGivenOut(params: SwapLinearPool): Promise<BigNumber> {
    return this.swap(this._buildSwapParams(SwapKind.GivenOut, params));
  }

  async swap(params: GeneralSwap): Promise<BigNumber> {
    const tx = await this.vault.generalSwap(params);
    const receipt = await (await tx).wait();
    const { amount } = expectEvent.inReceipt(receipt, 'Swap').args;
    return amount;
  }

  private _buildSwapParams(kind: number, params: SwapLinearPool): GeneralSwap {
    return {
      kind,
      poolAddress: this.address,
      poolId: this.poolId,
      from: params.from,
      to: params.recipient ?? ZERO_ADDRESS,
      tokenIn: params.in < this.tokens.length ? this.tokens.get(params.in)?.address ?? ZERO_ADDRESS : ZERO_ADDRESS,
      tokenOut: params.out < this.tokens.length ? this.tokens.get(params.out)?.address ?? ZERO_ADDRESS : ZERO_ADDRESS,
      lastChangeBlock: params.lastChangeBlock ?? 0,
      data: params.data ?? '0x',
      amount: params.amount,
      balances: params.balances,
      indexIn: params.in,
      indexOut: params.out,
    };
  }
}
