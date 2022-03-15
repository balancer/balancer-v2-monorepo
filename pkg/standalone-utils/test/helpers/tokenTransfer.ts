import { BigNumberish, ContractReceipt } from 'ethers';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';

export function expectTransferEvent(
  receipt: ContractReceipt,
  args: { from?: string; to?: string; value?: BigNumberish },
  token: Token
): any {
  return expectEvent.inIndirectReceipt(receipt, token.instance.interface, 'Transfer', args, token.address);
}
