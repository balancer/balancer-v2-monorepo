import { ethers, network } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { MAX_UINT256 } from '../../lib/helpers/constants';
import { BigNumberish, bn } from '../../lib/helpers/numbers';
import { splitSignature } from 'ethers/lib/utils';

export const MAX_DEADLINE = MAX_UINT256;

export function encodeCalldataAuthorization(calldata: string, deadline: BigNumberish, signature: string): string {
  const { hexValue, hexZeroPad, splitSignature } = ethers.utils;
  const encodedDeadline = hexZeroPad(hexValue(deadline), 32).slice(2);
  const { v, r, s } = splitSignature(signature);
  const encodedV = hexZeroPad(hexValue(v), 32).slice(2);
  const encodedR = r.slice(2);
  const encodedS = s.slice(2);
  return `${calldata}${encodedDeadline}${encodedV}${encodedR}${encodedS}`;
}

export async function signJoinAuthorization(
  validator: Contract,
  user: SignerWithAddress,
  allowedSender: SignerWithAddress,
  allowedCalldata: string,
  nonce?: BigNumberish,
  deadline?: BigNumberish
): Promise<string> {
  return signAuthorizationFor('JoinAuth', validator, user, allowedSender, allowedCalldata, nonce, deadline);
}

export async function signExitAuthorization(
  validator: Contract,
  user: SignerWithAddress,
  allowedSender: SignerWithAddress,
  allowedCalldata: string,
  nonce?: BigNumberish,
  deadline?: BigNumberish
): Promise<string> {
  return signAuthorizationFor('ExitAuth', validator, user, allowedSender, allowedCalldata, nonce, deadline);
}

export async function signSwapAuthorization(
  validator: Contract,
  user: SignerWithAddress,
  allowedSender: SignerWithAddress,
  allowedCalldata: string,
  nonce?: BigNumberish,
  deadline?: BigNumberish
): Promise<string> {
  return signAuthorizationFor('SwapAuth', validator, user, allowedSender, allowedCalldata, nonce, deadline);
}

export async function signBatchSwapAuthorization(
  validator: Contract,
  user: SignerWithAddress,
  allowedSender: SignerWithAddress,
  allowedCalldata: string,
  nonce?: BigNumberish,
  deadline?: BigNumberish
): Promise<string> {
  return signAuthorizationFor('BatchSwapAuth', validator, user, allowedSender, allowedCalldata, nonce, deadline);
}

export async function signAuthorization(
  validator: Contract,
  user: SignerWithAddress,
  allowedSender: SignerWithAddress,
  allowedCalldata: string,
  nonce?: BigNumberish,
  deadline?: BigNumberish
): Promise<string> {
  return signAuthorizationFor('Authorization', validator, user, allowedSender, allowedCalldata, nonce, deadline);
}

export async function signAuthorizationFor(
  type: string,
  validator: Contract,
  user: SignerWithAddress,
  allowedSender: SignerWithAddress,
  allowedCalldata: string,
  nonce?: BigNumberish,
  deadline?: BigNumberish
): Promise<string> {
  if (!deadline) deadline = MAX_DEADLINE;
  if (!nonce) nonce = (await validator.getNextNonce(user)) as BigNumberish;

  const domain = {
    name: 'Balancer Protocol',
    version: '1',
    chainId: await network.provider.send('eth_chainId'),
    verifyingContract: validator.address,
  };

  const types = {
    [type]: [
      { name: 'calldata', type: 'bytes' },
      { name: 'sender', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  };

  const value = {
    calldata: allowedCalldata,
    sender: allowedSender.address,
    nonce: nonce.toString(),
    deadline: deadline.toString(),
  };

  return user._signTypedData(domain, types, value);
}

export async function signPermit(
  token: Contract,
  owner: SignerWithAddress,
  spender: SignerWithAddress,
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
