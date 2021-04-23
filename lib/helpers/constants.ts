import { BigNumber } from 'ethers';

import { maxUint, maxInt, minInt } from './numbers';

export const MAX_UINT256: BigNumber = maxUint(256);
export const MAX_UINT112: BigNumber = maxUint(112);
export const MAX_UINT31: BigNumber = maxUint(31);
export const MAX_UINT32: BigNumber = maxUint(32);

export const MIN_INT22: BigNumber = minInt(22);
export const MAX_INT22: BigNumber = maxInt(22);
export const MIN_INT53: BigNumber = minInt(53);
export const MAX_INT53: BigNumber = maxInt(53);
export const MAX_INT256: BigNumber = maxInt(256);

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';

export const MAX_GAS_LIMIT = 8e6;
