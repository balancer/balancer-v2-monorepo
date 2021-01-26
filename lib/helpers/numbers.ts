import { Decimal } from 'decimal.js';
import { BigNumber as BN } from 'ethers';

const SCALING_FACTOR = 1e18;

export type BigNumberish = string | number | BN;

export const fp = (x: number): BN => bn(x * SCALING_FACTOR);

export const bn = (x: BigNumberish | Decimal): BN =>
  BN.isBigNumber(x) ? x : BN.from(parseInt(x.toString()).toString());

export const decimal = (x: BigNumberish): Decimal => new Decimal(x.toString());

export const maxUint = (e: number): BN => bn(2).pow(e).sub(1);

export const maxInt = (e: number): BN => bn(2).pow(bn(e).sub(1)).sub(1);

export const minInt = (e: number): BN => bn(2).pow(bn(e).sub(1)).mul(-1);

export const pct = (n: BN, pct: number): BN => n.div(bn(1 / pct));

export const FP_SCALING_FACTOR = bn(SCALING_FACTOR);
