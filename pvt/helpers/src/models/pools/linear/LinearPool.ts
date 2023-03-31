import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, Contract, ContractTransaction } from 'ethers';

import { SwapKind } from '@balancer-labs/balancer-js';
import { actionId } from '../../misc/actions';
import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import { GeneralSwap } from '../../vault/types';
import { Account, TxParams } from '../../types/types';
import { SwapLinearPool, RawLinearPoolDeployment } from './types';

import Vault from '../../vault/Vault';
import Token from '../../tokens/Token';
import TokenList from '../../tokens/TokenList';
import TypesConverter from '../../types/TypesConverter';
import LinearPoolDeployer from './LinearPoolDeployer';
import { deployedAt } from '../../../contract';
import BasePool from '../base/BasePool';

export default class LinearPool extends BasePool {
  mainToken: Token;
  wrappedToken: Token;
  bptToken: Token;
  lowerTarget: BigNumberish;
  upperTarget: BigNumberish;
  assetManagers: string[];

  static async create(params: RawLinearPoolDeployment, mockedVault: boolean): Promise<LinearPool> {
    return LinearPoolDeployer.deploy(params, mockedVault);
  }

  static async deployedAt(address: Account): Promise<LinearPool> {
    const instance = await deployedAt('v2-pool-linear/LinearPool', TypesConverter.toAddress(address));
    const [poolId, vault, mainToken, wrappedToken, [lowerTarget, upperTarget], swapFee, owner] = await Promise.all([
      instance.getPoolId(),
      instance.getVault(),
      instance.getMainToken(),
      instance.getWrappedToken(),
      instance.getTargets(),
      instance.getSwapFeePercentage(),
      instance.getOwner(),
    ]);
    return new LinearPool(
      instance,
      poolId,
      vault,
      await Token.deployedAt(mainToken),
      await Token.deployedAt(wrappedToken),
      await Token.deployedAt(instance.address),
      lowerTarget,
      upperTarget,
      swapFee,
      owner
    );
  }

  // Order the tokens the same way the Vault will
  static getTokenList(mainToken: Token, wrappedToken: Token, bptToken: Token): TokenList {
    const tokens: Token[] = [];

    tokens.push(bptToken);
    tokens.push(mainToken.address < wrappedToken.address ? mainToken : wrappedToken);
    tokens.push(mainToken.address < wrappedToken.address ? wrappedToken : mainToken);

    return new TokenList(tokens);
  }

  constructor(
    instance: Contract,
    poolId: string,
    vault: Vault,
    mainToken: Token,
    wrappedToken: Token,
    bptToken: Token,
    lowerTarget: BigNumberish,
    upperTarget: BigNumberish,
    assetManagers: string[],
    swapFeePercentage: BigNumberish,
    owner?: SignerWithAddress
  ) {
    super(
      instance,
      poolId,
      vault,
      LinearPool.getTokenList(mainToken, wrappedToken, bptToken),
      swapFeePercentage,
      owner
    );
    this.mainToken = mainToken;
    this.wrappedToken = wrappedToken;
    this.bptToken = bptToken;
    this.lowerTarget = lowerTarget;
    this.upperTarget = upperTarget;
    this.assetManagers = assetManagers;
  }

  get address(): string {
    return this.instance.address;
  }

  get getLinearTokens(): TokenList {
    return LinearPool.getTokenList(this.mainToken, this.wrappedToken, this.bptToken);
  }

  get mainIndex(): number {
    return this.getTokenIndex(this.mainToken);
  }

  get wrappedIndex(): number {
    return this.getTokenIndex(this.wrappedToken);
  }

  get bptIndex(): number {
    return this.getTokenIndex(this.bptToken);
  }

  get tokenIndexes(): { mainIndex: number; wrappedIndex: number; bptIndex: number } {
    const mainIndex = this.mainIndex;
    const wrappedIndex = this.wrappedIndex;
    const bptIndex = this.bptIndex;
    return { mainIndex, wrappedIndex, bptIndex };
  }

  getTokenIndex(token: Token): number {
    const addresses = this.tokens.addresses;
    return addresses[0] == token.address ? 0 : addresses[1] == token.address ? 1 : 2;
  }

  async getWrappedTokenRate(): Promise<BigNumber> {
    return this.instance.getWrappedTokenRate();
  }

  async getVirtualSupply(): Promise<BigNumber> {
    return this.instance.getVirtualSupply();
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

  async setSwapFeePercentage(swapFeePercentage: BigNumber, txParams: TxParams = {}): Promise<ContractTransaction> {
    const sender = txParams.from || this.owner;
    const pool = sender ? this.instance.connect(sender) : this.instance;
    return pool.setSwapFeePercentage(swapFeePercentage);
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
    const { amountIn, amountOut } = expectEvent.inReceipt(receipt, 'Swap').args;

    return params.kind == SwapKind.GivenIn ? amountOut : amountIn;
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

  async pause(): Promise<void> {
    const pauseAction = await actionId(this.instance, 'pause');
    const unpauseAction = await actionId(this.instance, 'unpause');
    await this.vault.grantPermissionGloballyIfNeeded(pauseAction);
    await this.vault.grantPermissionGloballyIfNeeded(unpauseAction);
    await this.instance.pause();
  }
}
