import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { MAX_UINT256 } from '../../lib/helpers/constants';
import { BigNumberish } from '../../lib/helpers/numbers';

export function encodeCalldataAuthorization(calldata: string, deadline: BigNumberish, signature: string): string {
  const { hexValue, hexZeroPad, splitSignature } = ethers.utils;
  const encodedDeadline = hexZeroPad(hexValue(deadline), 32).slice(2);
  const { v, r, s } = splitSignature(signature);
  const encodedV = hexZeroPad(hexValue(v), 32).slice(2);
  const encodedR = r.slice(2);
  const encodedS = s.slice(2);
  return `${calldata}${encodedDeadline}${encodedV}${encodedR}${encodedS}`;
}

export async function signAuthorization(
  validator: Contract,
  user: SignerWithAddress,
  allowedSender: SignerWithAddress,
  allowedCalldata: string,
  nonce?: BigNumberish,
  deadline?: BigNumberish
): Promise<string> {
  if (!deadline) deadline = MAX_UINT256;
  if (!nonce) nonce = (await validator.getNextNonce(user)) as BigNumberish;

  const domain = {
    name: 'Balancer Protocol',
    version: '1',
    chainId: (await validator.getChainId()).toString(),
    verifyingContract: validator.address,
  };

  const types = {
    Authorization: [
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
