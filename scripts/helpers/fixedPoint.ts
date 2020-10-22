import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';

export function toFixedPoint(value: number): BigNumber {
  return ethers.BigNumber.from((value * 1e18).toString());
}
