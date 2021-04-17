import { maxUint, maxInt } from './numbers';
import { BigNumber } from 'ethers';

export const MAX_UINT256: BigNumber = maxUint(256);
export const MAX_UINT112: BigNumber = maxUint(112);
export const MAX_UINT32: BigNumber = maxUint(32);

export const MAX_INT256: BigNumber = maxInt(256);

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';

export const MAX_GAS_LIMIT = 8e6;
