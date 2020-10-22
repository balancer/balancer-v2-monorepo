import { Contract, Signer } from 'ethers';
import { fromPairs, Dictionary } from 'lodash';
import { deploy } from '../../scripts/helpers/deploy';

export type TokenList = Dictionary<Contract>;

// Deploys a vanilla ERC20 token that can be minted by any account
export async function deployToken(symbol: string, decimals?: number): Promise<Contract> {
  const token = await deploy('TestToken', symbol, symbol, decimals ?? 18);
  return token;
}

// Deploys multiple tokens and returns a symbol -> token dictionary, which can be used in other helpers
export async function deployTokens(symbols: Array<string>): Promise<TokenList> {
  return fromPairs(await Promise.all(symbols.map(async (symbol) => [symbol, await deployToken(symbol)])));
}

export async function mintTokens(
  tokens: TokenList,
  symbol: string,
  recipient: Signer | string,
  amount: number | string
): Promise<void> {
  await tokens[symbol].mint(typeof recipient == 'string' ? recipient : await recipient.getAddress(), amount.toString());
}

export function generateAddressArray(num: number): string[] {
  return [
    '0x0000000000000000000000000000000000000001',
    '0x0000000000000000000000000000000000000002',
    '0x0000000000000000000000000000000000000003',
    '0x0000000000000000000000000000000000000004',
    '0x0000000000000000000000000000000000000005',
    '0x0000000000000000000000000000000000000006',
    '0x0000000000000000000000000000000000000007',
    '0x0000000000000000000000000000000000000008',
    '0x0000000000000000000000000000000000000009',
    '0x0000000000000000000000000000000000000010',
    '0x0000000000000000000000000000000000000011',
    '0x0000000000000000000000000000000000000012',
    '0x0000000000000000000000000000000000000013',
    '0x0000000000000000000000000000000000000014',
    '0x0000000000000000000000000000000000000015',
    '0x0000000000000000000000000000000000000016',
  ].slice(0, num);
}
