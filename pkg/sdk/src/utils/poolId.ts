import { BigNumber } from '@ethersproject/bignumber';
import { PoolSpecialization } from '../types';
import invariant from 'tiny-invariant';

export const splitPoolId = (
  poolId: string
): { address: string; specialization: PoolSpecialization; nonce: BigNumber } => {
  return {
    address: getPoolAddress(poolId),
    specialization: getPoolSpecialization(poolId),
    nonce: getPoolNonce(poolId),
  };
};

export const getPoolAddress = (poolId: string): string => {
  invariant(poolId.length === 66, 'Invalid poolId length');
  return poolId.slice(0, 42);
};

export const getPoolSpecialization = (poolId: string): PoolSpecialization => {
  invariant(poolId.length === 66, 'Invalid poolId length');

  // Only have 3 pool specializations so we can just pull the relevant character
  const specializationCode = parseInt(poolId[45]);
  invariant(specializationCode < 3, 'Invalid pool specialization');

  return specializationCode;
};

export const getPoolNonce = (poolId: string): BigNumber => {
  invariant(poolId.length === 66, 'Invalid poolId length');
  return BigNumber.from(`0x${poolId.slice(46)}`);
};
