import { SignerWithAddress } from 'hardhat-deploy-ethers/dist/src/signer-with-address';
import { Contract } from 'ethers';
import { fromPairs, Dictionary } from 'lodash';
import { deploy } from '../../scripts/helpers/deploy';

export type TokenList = Dictionary<Contract>;

// Deploys multiple tokens and returns a symbol -> token dictionary, which can be used in other helpers
export async function deployTokens(
  symbols: Array<string>,
  decimals: Array<number>,
  from?: SignerWithAddress
): Promise<TokenList> {
  return fromPairs(
    await Promise.all(
      symbols.map(async (symbol, index) => [
        symbol,
        await deploy('TestToken', { from, args: [symbol, symbol, decimals[index]] }),
      ])
    )
  );
}

export async function mintTokens(
  tokens: TokenList,
  symbol: string,
  recipient: SignerWithAddress | string,
  amount: number | string
): Promise<void> {
  await tokens[symbol].mint(typeof recipient == 'string' ? recipient : recipient.address, amount.toString());
}
