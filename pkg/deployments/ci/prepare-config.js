const path = require('path');
const { homedir } = require('os');
const { mkdirSync, writeFileSync } = require('fs');
const HH_CONFIG_FILENAME = `${homedir()}/.hardhat/networks.json`;

if (process.env.CI) {
  const content = `{
    "networks": {
      "mainnet": {
        "url": "${process.env.ALCHEMY_MAINNET_ARCHIVE_ENDPOINT}"
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
