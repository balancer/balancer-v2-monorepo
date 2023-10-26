import { BigNumber, Contract, ethers } from 'ethers';

import { setupEnvironment } from './misc';
import { bn, printGas } from '@balancer-labs/v2-helpers/src/numbers';
import { BytesLike } from 'ethers/lib/utils';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';

let vault: Vault;
let relayerLibrary: Contract, relayer: Contract;

const maxInputLength = 256;
const wordBytesSize = 32;

async function main() {
  ({ vault } = await setupEnvironment());
  relayerLibrary = await deploy('v2-standalone-utils/MockBaseRelayerLibrary', { args: [vault.address, ''] });
  const queryLibrary = await deploy('v2-standalone-utils/BatchRelayerQueryLibrary', { args: [vault.address] });
  relayer = await deploy('v2-standalone-utils/BalancerRelayer', {
    args: [vault.address, relayerLibrary.address, queryLibrary.address, ''],
  });
  let totalGasUsed = bn(0);

  console.log('== Measuring multicall gas usage ==\n');
  // We do 32-byte jumps, which is equivalent to adding a word to the array.
  for (let i = 0; i <= maxInputLength; i += wordBytesSize) {
    totalGasUsed = totalGasUsed.add(await testMulticall(i));
  }

  console.log(`\n# Average gas per call: ${printGas(totalGasUsed.div(maxInputLength / wordBytesSize + 1))}`);
}

async function testMulticall(bytesLength: number): Promise<BigNumber> {
  const data = ethers.utils.randomBytes(bytesLength);
  const receipt = await (await relayer.multicall([encodeBytesTunnel(data)])).wait();

  console.log(`Gas for input size ${bytesLength}: ${printGas(receipt.gasUsed)}`);
  return receipt.gasUsed.toNumber();
}

function encodeBytesTunnel(input: BytesLike): string {
  return relayerLibrary.interface.encodeFunctionData('bytesTunnel', [input]);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
