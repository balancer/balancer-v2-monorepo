import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { Contract, ContractReceipt } from 'ethers';
import { MAX_UINT256 } from '../../test/helpers/constants';
import { TokenList } from '../../test/helpers/tokens';

export const PairTS = 0;
export const TupleTS = 1;

export type TradingStrategyType = typeof PairTS | typeof TupleTS;

export async function setupPool(
  vault: Contract,
  strategy: Contract,
  strategyType: number,
  tokens: TokenList,
  controller: SignerWithAddress,
  makeup: Array<[string, number]>
): Promise<string> {
  vault = vault.connect(controller);

  const receipt: ContractReceipt = await (
    await vault.connect(controller).newPool(strategy.address, strategyType)
  ).wait();

  const event = receipt.events?.find((e) => e.event == 'PoolCreated');
  if (event == undefined) {
    throw new Error('Could not find PoolCreated event');
  }

  const poolId: string = event.args?.poolId;

  for (const entry of makeup) {
    const token = tokens[entry[0]];

    await token.mint(controller.address, entry[1].toString());
    await token.connect(controller).approve(vault.address, MAX_UINT256);

    await vault.connect(controller).addLiquidity(poolId, controller.address, [token.address], [entry[1].toString()]);
  }

  return poolId;
}
