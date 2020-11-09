import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { Contract, ContractReceipt } from 'ethers';
import { ethers } from 'hardhat';
import { MAX_UINT256 } from '../../test/helpers/constants';
import { TokenList } from '../../test/helpers/tokens';
import { deploy } from './deploy';

export async function setupTokenizer(
  vault: Contract,
  admin: SignerWithAddress,
  strategy: Contract,
  strategyType: number,
  tokens: TokenList,
  lp: SignerWithAddress,
  initialBPT: string,
  makeup: Array<[string, string]>
): Promise<Contract> {
  const factory = await deploy('FixedSetPoolTokenizerFactory', { args: [vault.address] });

  // Authorize factory so that created controllers are trusted operators
  await vault.connect(admin).authorizeTrustedOperatorReporter(factory.address);

  // Mint tokens to LP and approve vault to use them
  for (const entry of makeup) {
    const token = tokens[entry[0]];

    await token.mint(lp.address, entry[1]);
    await token.connect(lp).approve(vault.address, MAX_UINT256);
  }

  const salt = ethers.utils.id(Math.random().toString());

  const receipt: ContractReceipt = await (
    await factory.connect(lp).create(
      strategy.address,
      strategyType,
      initialBPT,
      makeup.map((entry) => tokens[entry[0]].address),
      makeup.map((entry) => entry[1]),
      salt
    )
  ).wait();

  const event = receipt.events?.find((e) => e.event == 'TokenizerCreated');
  if (event == undefined) {
    throw new Error('Could not find TokenizerCreated event');
  }

  return ethers.getContractAt('FixedSetPoolTokenizer', event.args?.tokenizer);
}
