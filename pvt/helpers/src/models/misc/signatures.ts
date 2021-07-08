import { network } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { MAX_UINT256 } from '../../constants';
import { BigNumberish, bn } from '../../numbers';
import { splitSignature } from 'ethers/lib/utils';

export const MAX_DEADLINE = MAX_UINT256;

export async function signPermit(
  token: Contract,
  owner: SignerWithAddress,
  spender: SignerWithAddress | Contract,
  amount: BigNumberish,
  nonce?: BigNumberish,
  deadline?: BigNumberish
): Promise<{ v: number; r: string; s: string; deadline: BigNumber }> {
  if (!deadline) deadline = MAX_DEADLINE;
  if (!nonce) nonce = (await token.nonces(owner.address)) as BigNumberish;

  const domain = {
    name: await token.name(),
    version: '1',
    chainId: await network.provider.send('eth_chainId'),
    verifyingContract: token.address,
  };

  const types = {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  };

  const value = {
    owner: owner.address,
    spender: spender.address,
    value: bn(amount).toString(),
    nonce: bn(nonce).toString(),
    deadline: bn(deadline).toString(),
  };

  const signature = await owner._signTypedData(domain, types, value);
  return { ...splitSignature(signature), deadline: bn(deadline) };
}
