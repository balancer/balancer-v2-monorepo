import { BigNumberish, ContractReceipt } from 'ethers';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { Interface } from 'ethers/lib/utils';
import { Account } from '../models/types/types';
import TypesConverter from '../models/types/TypesConverter';

export function expectTransferEvent(
  receipt: ContractReceipt,
  args: { from?: string; to?: string; value?: BigNumberish },
  token: Account
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  if (receipt.to.toLowerCase() === TypesConverter.toAddress(token).toLowerCase()) {
    return expectEvent.inReceipt(receipt, 'Transfer', args);
  }
  return expectEvent.inIndirectReceipt(
    receipt,
    new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']),
    'Transfer',
    args,
    TypesConverter.toAddress(token)
  );
}
