import Token from './Token';
import TokensDeployer from './TokensDeployer';
import TypesConverter from '../types/TypesConverter';
import {
  RawTokenApproval,
  RawTokenMint,
  RawTokensDeployment,
  TokenApproval,
  TokenMint,
  TokensDeploymentOptions,
} from './types';

export default class TokenList {
  tokens: Token[];

  static async create(params: RawTokensDeployment, options: TokensDeploymentOptions = {}): Promise<TokenList> {
    return TokensDeployer.deploy(params, options);
  }

  constructor(tokens: Token[] = []) {
    this.tokens = tokens;
  }

  get length(): number {
    return this.tokens.length;
  }

  get addresses(): string[] {
    return this.tokens.map((token) => token.address);
  }

  get first(): Token {
    return this.get(0);
  }

  get second(): Token {
    return this.get(1);
  }

  get(index: number): Token {
    if (index >= this.length) throw Error('Accessing invalid token list index');
    return this.tokens[index];
  }

  get DAI(): Token {
    return this.findBySymbol('DAI');
  }

  get MKR(): Token {
    return this.findBySymbol('MKR');
  }

  get SNX(): Token {
    return this.findBySymbol('SNX');
  }

  get BAT(): Token {
    return this.findBySymbol('BAT');
  }

  subset(length: number): TokenList {
    return new TokenList(this.tokens.slice(0, length));
  }

  async mint(rawParams: RawTokenMint): Promise<void> {
    const params: TokenMint[] = TypesConverter.toTokenMints(rawParams);
    await Promise.all(
      params.flatMap(({ to, amount, from }) => this.tokens.map((token) => token.mint(to, amount, { from })))
    );
  }

  async approve(rawParams: RawTokenApproval): Promise<void> {
    const params: TokenApproval[] = TypesConverter.toTokenApprovals(rawParams);
    await Promise.all(
      params.flatMap(({ to, amount, from }) => this.tokens.map((token) => token.approve(to, amount, { from })))
    );
  }

  each(fn: (value: Token, i: number, array: Token[]) => void, thisArg?: unknown): void {
    this.tokens.forEach(fn, thisArg);
  }

  async asyncEach(fn: (value: Token, i: number, array: Token[]) => Promise<void>, thisArg?: unknown): Promise<void> {
    await this.asyncMap(fn, thisArg);
  }

  map<T>(fn: (value: Token, i: number, array: Token[]) => T, thisArg?: unknown): T[] {
    return this.tokens.map(fn, thisArg);
  }

  async asyncMap<T>(fn: (value: Token, i: number, array: Token[]) => Promise<T>, thisArg?: unknown): Promise<T[]> {
    const promises = this.tokens.map(fn, thisArg);
    return Promise.all(promises);
  }

  reduce<T>(fn: (previousValue: T, currentValue: Token, i: number, array: Token[]) => T, initialValue: T): T {
    return this.tokens.reduce(fn, initialValue);
  }

  findBySymbol(symbol: string): Token {
    const token = this.tokens.find((token) => token.symbol.toLowerCase() === symbol.toLowerCase());
    if (!token) throw Error(`Could not find token with symbol ${symbol}`);
    return token;
  }
}
