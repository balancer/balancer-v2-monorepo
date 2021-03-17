import { Signer } from 'ethers';
import { BigNumberish, bn } from '../../../../lib/helpers/numbers';
import { Account } from '../types/types';
import TypesConverter from '../types/TypesConverter';
import Token from './Token';

export default class WETH extends Token {
  async mintWETH({ to, from, amount }: { to: Account; from: Signer; amount: BigNumberish }): Promise<void> {
    const weth = this.instance;
    await weth.connect(from).deposit({ value: bn(amount) });
    await weth.connect(from).transfer(TypesConverter.toAddress(to), bn(amount));
  }
}
