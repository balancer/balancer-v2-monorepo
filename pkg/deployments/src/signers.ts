import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { getForkedNetwork } from './test';

const WHALES: { [key: string]: string } = {
  mainnet: '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503',
};

export async function getSigners(): Promise<SignerWithAddress[]> {
  const { ethers } = await import('hardhat');
  return ethers.getSigners();
}

export async function getSigner(indexOrAddress: number | string = 0): Promise<SignerWithAddress> {
  if (typeof indexOrAddress === 'string') {
    const { ethers } = await import('hardhat');
    const signer = ethers.provider.getSigner(indexOrAddress);
    return SignerWithAddress.create(signer);
  } else {
    const signers = await getSigners();
    return signers[indexOrAddress];
  }
}

export async function impersonate(address: string, balance?: BigNumber): Promise<SignerWithAddress> {
  if (balance) {
    await setBalance(address, balance);
  }

  return getSigner(address);
}

export async function impersonateWhale(balance?: BigNumber): Promise<SignerWithAddress> {
  const hre = await import('hardhat');
  const network = getForkedNetwork(hre);
  const address = WHALES[network];
  if (!address) throw Error(`Could not find whale address for network ${network}`);
  return impersonate(address, balance);
}

export async function setBalance(address: string, balance: BigNumber): Promise<void> {
  const hre = await import('hardhat');
  await hre.network.provider.request({ method: 'hardhat_impersonateAccount', params: [address] });

  const rawHexBalance = hre.ethers.utils.hexlify(balance);
  const hexBalance = rawHexBalance.replace('0x0', '0x');
  await hre.network.provider.request({ method: 'hardhat_setBalance', params: [address, hexBalance] });
}
