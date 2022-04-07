import { ethers } from 'hardhat';

import { deploy } from '../../contract';

import Token from './Token';
import TokenList from './TokenList';
import TypesConverter from '../types/TypesConverter';
import { RawTokenDeployment, RawTokensDeployment, TokenDeployment, TokensDeploymentOptions } from './types';

class TokensDeployer {
  async deploy(
    params: RawTokensDeployment,
    { sorted, varyDecimals, from }: TokensDeploymentOptions = {}
  ): Promise<TokenList> {
    const defaultSender = from || (await ethers.getSigners())[0];
    const trimmedParams = sorted ? this._trimParamsForSortedDeploy(params) : params;
    const deployments: TokenDeployment[] = TypesConverter.toTokenDeployments(
      trimmedParams,
      defaultSender,
      varyDecimals
    );
    const tokens = await Promise.all(deployments.map(this.deployToken));
    const sortedTokens = sorted ? this._sortTokensDeployment(tokens, params) : tokens;
    return new TokenList(sortedTokens);
  }

  async deployToken(params: RawTokenDeployment): Promise<Token> {
    const { symbol, name, decimals, from } = TypesConverter.toTokenDeployment(params);
    const sender = from || (await ethers.getSigners())[0];

    let instance;
    if (symbol !== 'WETH') {
      instance = await deploy('v2-standalone-utils/TestToken', {
        from: sender,
        args: [name, symbol, decimals],
      });
    } else {
      instance = await deploy('v2-standalone-utils/TestWETH', {
        from: sender,
        args: [],
      });
    }

    return new Token(name, symbol, decimals, instance);
  }

  private _sortTokensDeployment(tokens: Token[], params: RawTokensDeployment): Token[] {
    const sortedTokens = [...tokens].sort((a, b) => a.compare(b));
    return TypesConverter.toTokenDeployments(params).map((param, i) => {
      const token = sortedTokens[i];
      token.name = param.name;
      token.symbol = param.symbol;
      return token;
    });
  }

  private _trimParamsForSortedDeploy(params: RawTokensDeployment): number {
    if (typeof params === 'number') return params;
    return Array.isArray(params) ? params.length : 1;
  }
}

export default new TokensDeployer();
