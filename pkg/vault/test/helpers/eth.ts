import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { BigNumberish, bn } from '@balancer-labs/v2-helpers/src/numbers';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';

export async function forceSendEth(recipient: Account, amount: BigNumberish): Promise<void> {
  await deploy('EthForceSender', { args: [TypesConverter.toAddress(recipient), { value: bn(amount) }] });
}
