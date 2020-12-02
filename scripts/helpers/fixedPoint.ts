import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';

const scalingFactor = 1e18;
export const FIXED_POINT_SCALING = BigNumber.from(scalingFactor.toString());

export function toFixedPoint(value: number): BigNumber {
  return ethers.BigNumber.from((value * scalingFactor).toString());
}
