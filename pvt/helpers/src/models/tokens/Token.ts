import { BigNumber, Contract, ContractTransaction } from 'ethers';

import { MAX_UINT256 } from '../../constants';
import { BigNumberish } from '../../numbers';

import TokensDeployer from './TokensDeployer';
import TypesConverter from '../types/TypesConverter';
import { Account, TxParams } from '../types/types';
import { RawTokenDeployment } from './types';
import { deployedAt } from '../../contract';

export default class Token {
  name: string;
  symbol: string;
  decimals: number;
  instance: Contract;

  static async create(params: RawTokenDeployment): Promise<Token> {
    return TokensDeployer.deployToken(params);
  }

  static async deployedAt(address: string): Promise<Token> {
    const instance = await deployedAt('v2-standalone-utils/TestToken', address);
    const [name, symbol, decimals] = await Promise.all([instance.name(), instance.symbol(), instance.decimals()]);
    if (symbol === 'WETH') {
      return new Token(name, symbol, decimals, await deployedAt('v2-standalone-utils/TestWETH', address));
    }
    return new Token(name, symbol, decimals, instance);
  }

  constructor(name: string, symbol: string, decimals: number, instance: Contract) {
    this.name = name;
    this.symbol = symbol;
    this.decimals = decimals;
    this.instance = instance;
  }

  get address(): string {
    return this.instance.address;
  }

  async balanceOf(account: Account): Promise<BigNumber> {
    return this.instance.balanceOf(TypesConverter.toAddress(account));
  }

  async mint(to: Account, amount?: BigNumberish, { from }: TxParams = {}): Promise<void> {
    const token = from ? this.instance.connect(from) : this.instance;

    if (this.symbol === 'WETH') {
      await token.deposit({ value: amount });
      await token.transfer(TypesConverter.toAddress(to), amount);
    } else {
      await token.mint(TypesConverter.toAddress(to), amount ?? MAX_UINT256);
    }
  }

  async transfer(to: Account, amount: BigNumberish, { from }: TxParams = {}): Promise<ContractTransaction> {
    const token = from ? this.instance.connect(from) : this.instance;
    return token.transfer(TypesConverter.toAddress(to), amount);
  }

  async approve(to: Account, amount?: BigNumberish, { from }: TxParams = {}): Promise<ContractTransaction> {
    const token = from ? this.instance.connect(from) : this.instance;
    return token.approve(TypesConverter.toAddress(to), amount ?? MAX_UINT256);
  }

  async burn(amount: BigNumberish, { from }: TxParams = {}): Promise<ContractTransaction> {
    const token = from ? this.instance.connect(from) : this.instance;
    return token.burn(amount);
  }

  compare(anotherToken: Token): number {
    return this.address.toLowerCase() > anotherToken.address.toLowerCase() ? 1 : -1;
  }
}
