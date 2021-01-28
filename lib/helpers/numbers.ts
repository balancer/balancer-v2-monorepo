import { Decimal } from 'decimal.js';
import { BigNumber } from 'ethers';

const SCALING_FACTOR = 1e18;

export type BigNumberish = string | number | BigNumber;

export const fp = (x: number): BigNumber => bn(x * SCALING_FACTOR);

export const bn = (x: BigNumberish | Decimal): BigNumber =>
  BigNumber.isBigNumber(x) ? x : BigNumber.from(parseInt(x.toString()).toString());

export const decimal = (x: BigNumberish): Decimal => new Decimal(x.toString());

export const maxUint = (e: number): BigNumber => bn(2).pow(e).sub(1);

export const maxInt = (e: number): BigNumber => bn(2).pow(bn(e).sub(1)).sub(1);

export const minInt = (e: number): BigNumber => bn(2).pow(bn(e).sub(1)).mul(-1);

export const pct = (x: BigNumberish, pct: number): BigNumber => bn(decimal(x).div(decimal(1).div(decimal(pct))));

export const FP_SCALING_FACTOR = bn(SCALING_FACTOR);
