import { ethers } from '@nomiclabs/buidler';
import { BigNumber } from 'ethers';

export function toFixedPoint(value: number): BigNumber {
  return ethers.BigNumber.from((value * 1e18).toString());
}
