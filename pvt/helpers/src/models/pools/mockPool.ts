import { ethers } from 'ethers';
import { BigNumberish } from '../../numbers';

export const encodeJoin = (joinAmounts: BigNumberish[], dueProtocolFeeAmounts: BigNumberish[]): string =>
  encodeJoinExitMockPool(joinAmounts, dueProtocolFeeAmounts);

export const encodeExit = (exitAmounts: BigNumberish[], dueProtocolFeeAmounts: BigNumberish[]): string =>
  encodeJoinExitMockPool(exitAmounts, dueProtocolFeeAmounts);

function encodeJoinExitMockPool(amounts: BigNumberish[], dueProtocolFeeAmounts: BigNumberish[]): string {
  return ethers.utils.defaultAbiCoder.encode(['uint256[]', 'uint256[]'], [amounts, dueProtocolFeeAmounts]);
}
