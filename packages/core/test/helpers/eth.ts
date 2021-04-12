import { deploy } from '@balancer-labs/v2-helpers/src/deploy';
import { BigNumberish, bn } from '@balancer-labs/v2-helpers/src/numbers';

import { Account } from './models/types/types';
import TypesConverter from './models/types/TypesConverter';

export async function forceSendEth(recipient: Account, amount: BigNumberish): Promise<void> {
  await deploy('EthForceSender', { args: [TypesConverter.toAddress(recipient), { value: bn(amount) }] });
}
