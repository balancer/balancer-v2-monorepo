import path from 'path';
import { homedir } from 'os';
import { mkdirSync, writeFileSync } from 'fs';

const HH_CONFIG_FILENAME = `${homedir()}/.hardhat/networks.json`;

if (process.env.CI) {
  const content = `{
    "networks": {
      "mainnet": {
        "url": "${process.env.ALCHEMY_MAINNET_ARCHIVE_ENDPOINT}"
      },
      "polygon": {
        "url": "${process.env.ALCHEMY_POLYGON_ARCHIVE_ENDPOINT}"
      },
      "arbitrum": {
        "url": "${process.env.ALCHEMY_ARBITRUM_ARCHIVE_ENDPOINT}"
      },
      "optimism": {
        "url": "${process.env.ALCHEMY_OPTIMISM_ARCHIVE_ENDPOINT}"
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
