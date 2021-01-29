import { ethers } from 'ethers';
import { BigNumberish } from '../../lib/helpers/numbers';

export function encodeJoin(joinAmounts: BigNumberish[], dueProtocolFeeAmounts: BigNumberish[]): string {
  return ethers.utils.defaultAbiCoder.encode(['uint256[]', 'uint256[]'], [joinAmounts, dueProtocolFeeAmounts]);
}

export function encodeExit(exitAmounts: BigNumberish[], dueProtocolFeeAmounts: BigNumberish[]): string {
  return ethers.utils.defaultAbiCoder.encode(['uint256[]', 'uint256[]'], [exitAmounts, dueProtocolFeeAmounts]);
}
