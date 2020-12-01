import { BigNumber } from 'ethers';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';
export const MAX_UINT256 = BigNumber.from(2).pow(256).sub(1);
export const MAX_INT256 = BigNumber.from(2).pow(255).sub(1);
export const MIN_INT256 = BigNumber.from(2).pow(255).mul(-1);

export const MAX_UINT128 = BigNumber.from(2).pow(128).sub(1);
export const MAX_INT128 = BigNumber.from(2).pow(127).sub(1);
export const MIN_INT128 = BigNumber.from(2).pow(127).mul(-1);
