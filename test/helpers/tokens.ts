import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { Contract } from 'ethers';
import { fromPairs, Dictionary } from 'lodash';
import { deploy } from '../../scripts/helpers/deploy';

export type TokenList = Dictionary<Contract>;

// Deploys multiple tokens and returns a symbol -> token dictionary, which can be used in other helpers
export async function deployTokens(
  symbols: Array<string>,
  decimals: Array<number>,
  from?: SignerWithAddress,
  admin?: SignerWithAddress
): Promise<TokenList> {
  const adminAddress = admin?.address || (await ethers.getSigners())[0].address
  return fromPairs(
    await Promise.all(
      symbols.map(async (symbol, index) => [
        symbol,
        await deploy('TestToken', { from, args: [adminAddress, symbol, symbol, decimals[index]] }),
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
