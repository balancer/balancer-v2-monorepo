import { Signer, TypedDataSigner } from '@ethersproject/abstract-signer';
import { BigNumber, BigNumberish } from '@ethersproject/bignumber';
import { splitSignature } from '@ethersproject/bytes';
import { MaxUint256 as MAX_DEADLINE } from '@ethersproject/constants';
import { Contract } from '@ethersproject/contracts';
import { Account, accountToAddress } from './signatures';

export const signPermit = async (
  token: Contract,
  owner: Signer & TypedDataSigner,
  spender: Account,
  amount: BigNumberish,
  deadline: BigNumberish = MAX_DEADLINE,
  nonce?: BigNumberish
): Promise<{ v: number; r: string; s: string; deadline: BigNumber; nonce: BigNumber }> => {
  const { chainId } = await token.provider.getNetwork();
  const ownerAddress = await owner.getAddress();

  if (!nonce) nonce = (await token.nonces(ownerAddress)) as BigNumberish;

  // Hack around some tokens not exposing a `version()` function.
  // If they do then use it, otherwise assume that their version is "1".
  let version = '1';
  try {
    if (token.version) {
      version = await token.version();
    }
  } catch {
    // eslint-disable-prev-line no-empty
  }

  const domain = {
    name: await token.name(),
    version,
    chainId,
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
    owner: ownerAddress,
    spender: await accountToAddress(spender),
    value: amount,
    nonce,
    deadline,
  };

  const signature = await owner._signTypedData(domain, types, value);
  return { ...splitSignature(signature), deadline: BigNumber.from(deadline), nonce: BigNumber.from(nonce) };
};
