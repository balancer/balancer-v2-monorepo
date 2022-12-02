import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { impersonateAccount, setBalance as setAccountBalance } from '@nomicfoundation/hardhat-network-helpers';

export async function getSigners(): Promise<SignerWithAddress[]> {
  const { ethers } = await import('hardhat');
  return ethers.getSigners();
}

export async function getSigner(index = 0): Promise<SignerWithAddress> {
  return (await getSigners())[index];
}

export async function impersonate(address: string, balance = BigNumber.from(100e18)): Promise<SignerWithAddress> {
  await impersonateAccount(address);
  await setBalance(address, balance);

  const { ethers } = await import('hardhat');
  const signer = ethers.provider.getSigner(address);
  return SignerWithAddress.create(signer);
}

export async function setBalance(address: string, balance: BigNumber): Promise<void> {
  await setAccountBalance(address, balance);
}
