import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { defaultAbiCoder } from '@ethersproject/abi';
import { BigNumber, Contract, ContractTransaction } from 'ethers';

import { SwapKind } from '@balancer-labs/balancer-js';
import { actionId } from '../../misc/actions';
import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import { GeneralSwap } from '../../vault/types';
import { Account, TxParams } from '../../types/types';
import { SwapSecondaryPool, RawSecondaryPoolDeployment } from './types';

import Vault from '../../vault/Vault';
import Token from '../../tokens/Token';
import TokenList from '../../tokens/TokenList';
import TypesConverter from '../../types/TypesConverter';
import SecondaryPoolDeployer from './SecondaryIssuePoolDeployer';
import { deployedAt } from '../../../contract';
import BasePool from '../base/BasePool';

export default class SecondaryPool extends BasePool{
  instance: Contract;
  poolId: string;
  securityToken: Token;
  currencyToken: Token;
  bptToken: Token;
  maxSecurityOffered: BigNumberish;
  swapFeePercentage: BigNumberish;
  vault: Vault;
  owner?: SignerWithAddress;

  static async create(params: RawSecondaryPoolDeployment, mockedVault: boolean): Promise<SecondaryPool> {
    return SecondaryPoolDeployer.deploy(params, mockedVault);
  }

  static async deployedAt(address: Account): Promise<SecondaryPool> {
    const instance = await deployedAt('pool-secondary-issues/SecondaryIssuePool', TypesConverter.toAddress(address));
    const [poolId, vault, securityToken, currencyToken, maxSecurityOffered, swapFee, owner] = await Promise.all([
      instance.getPoolId(),
      instance.getVault(),
      instance.getSecurityToken(),
      instance.getCurrencyToken(),
      instance.getMaxSecurityOffered(),
      instance.getSwapFeePercentage(),
      instance.getOwner()
    ]);
    return new SecondaryPool(
      instance,
      poolId,
      vault,
      await Token.deployedAt(securityToken),
      await Token.deployedAt(currencyToken),
      await Token.deployedAt(instance.address),
      maxSecurityOffered,
      swapFee,
      owner
    );
  }

  constructor(
    instance: Contract,
    poolId: string,
    vault: Vault,
    securityToken: Token,
    currencyToken: Token,
    bptToken: Token,
    maxSecurityOffered: BigNumberish,
    swapFeePercentage: BigNumberish,
    owner?: SignerWithAddress
  ) {
    super(instance, poolId, vault, new TokenList([securityToken, currencyToken, bptToken]).sort(), swapFeePercentage, owner);
    this.instance = instance;
    this.poolId = poolId;
    this.vault = vault;
    this.securityToken = securityToken;
    this.currencyToken = currencyToken;
    this.bptToken = bptToken;
    this.maxSecurityOffered = maxSecurityOffered;
    this.swapFeePercentage = swapFeePercentage;
    this.owner = owner;
  }

  get address(): string {
    return this.instance.address;
  }

  get getSecondaryTokens(): TokenList {
    return new TokenList([this.securityToken, this.currencyToken, this.bptToken]).sort();
  }

  get securityIndex(): number {
    return this.getTokenIndex(this.securityToken);
  }

  get currencyIndex(): number {
    return this.getTokenIndex(this.currencyToken);
  }

  get bptIndex(): number {
    return this.getTokenIndex(this.bptToken);
  }

  get tokenIndexes(): { securityIndex: number; currencyIndex: number, bptIndex: number } {
    const securityIndex = this.securityIndex;
    const currencyIndex = this.currencyIndex;
    const bptIndex = this.bptIndex;
    return { securityIndex, currencyIndex, bptIndex };
  }

  getTokenIndex(token: Token): number {
    const addresses = this.tokens.addresses;
    return addresses[0] == token.address ? 0 : addresses[1] == token.address ? 1 : 2;
  }

  async name(): Promise<string> {
    return this.instance.name();
  }

  async symbol(): Promise<string> {
    return this.instance.symbol();
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

  async getSwapFeePercentage(): Promise<BigNumber> {
    return this.instance.getSwapFeePercentage();
  }

  async getScalingFactors(): Promise<BigNumber[]> {
    return this.instance.getScalingFactors();
  }

  async getScalingFactor(token: Token): Promise<BigNumber> {
    return this.instance.getScalingFactor(token.address);
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

  async setSwapFeePercentage(swapFeePercentage: BigNumber, txParams: TxParams = {}): Promise<ContractTransaction> {
    const sender = txParams.from || this.owner;
    const pool = sender ? this.instance.connect(sender) : this.instance;
    return pool.setSwapFeePercentage(swapFeePercentage);
  }

  async initialize(): Promise<void> {
    return this.instance.initialize();
  }

  async swapGivenIn(params: SwapSecondaryPool): Promise<BigNumber> {
    return this.swap(this._buildSwapParams(SwapKind.GivenIn, params));
  }

  async swapGivenOut(params: SwapSecondaryPool): Promise<BigNumber> {
    return this.swap(this._buildSwapParams(SwapKind.GivenOut, params));
  }

  async swap(params: GeneralSwap): Promise<BigNumber> {
    const tx = await this.vault.generalSwap(params);
    const receipt = await (await tx).wait();
    const { amount } = expectEvent.inReceipt(receipt, 'Swap').args;
    return amount;
  }

  private _buildSwapParams(kind: number, params: SwapSecondaryPool): GeneralSwap {
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

  async pause(): Promise<void> {
    const action = await actionId(this.instance, 'setPaused');
    await this.vault.grantPermissionsGlobally([action]);
    await this.instance.setPaused(true);
  }
}
