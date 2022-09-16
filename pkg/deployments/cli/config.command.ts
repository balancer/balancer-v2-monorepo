import prompts from 'prompts';

import { NETWORKS, Network } from '../src/types';

const selectNetworkCommand = async (): Promise<Network> => {
  const { config: network } = await prompts({
    type: 'select',
    name: 'config',
    choices: NETWORKS.map((network) => ({ title: network, value: network })),
    message: 'Select config',
  });

  process.env.ENVIRONMENT = network;
  return network as Network;
};

export default selectNetworkCommand;
