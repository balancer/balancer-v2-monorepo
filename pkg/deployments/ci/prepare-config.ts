import path from 'path';
import { homedir } from 'os';
import { mkdirSync, writeFileSync } from 'fs';

const HH_CONFIG_FILENAME = `${homedir()}/.hardhat/networks.json`;

if (process.env.CI) {
  const content = `{
    "networks": {
      "mainnet": {
        "url": "${process.env.MAINNET_RPC_ENDPOINT}"
      },
      "polygon": {
        "url": "${process.env.POLYGON_RPC_ENDPOINT}"
      },
      "arbitrum": {
        "url": "${process.env.ARBITRUM_RPC_ENDPOINT}"
      },
      "optimism": {
        "url": "${process.env.OPTIMISM_RPC_ENDPOINT}"
      },
      "goerli": {
        "url": "${process.env.GOERLI_RPC_ENDPOINT}"
      }
    },
    "defaultConfig": {
      "gasPrice": "auto",
      "gasMultiplier": 1
    }
  }`;

  mkdirSync(path.dirname(HH_CONFIG_FILENAME), { recursive: true });
  writeFileSync(HH_CONFIG_FILENAME, content);
}
