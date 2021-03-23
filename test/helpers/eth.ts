import { deploy } from '../../lib/helpers/deploy';
import { BigNumberish, bn } from '../../lib/helpers/numbers';
import { Account } from './models/types/types';
import TypesConverter from './models/types/TypesConverter';

export async function forceSendEth(recipient: Account, amount: BigNumberish): Promise<void> {
  await deploy('EthForceSender', { args: [TypesConverter.toAddress(recipient), { value: bn(amount) }] });
}
