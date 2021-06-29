import fs from 'fs';
import path from 'path';
import { ActionType, RunSuperFunction, HardhatRuntimeEnvironment } from 'hardhat/types';

const DIRECTORIES = ['artifacts'];
const FUNCTIONS = ['queryBatchSwap', 'queryExit', 'queryJoin'];

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

const override: ActionType<any> = async (
  args: any,
  env: HardhatRuntimeEnvironment,
  run: RunSuperFunction<any>
): Promise<any> => {
  const result = await run();
  DIRECTORIES.forEach(traverseDirectory);
  return result;
};

function traverseDirectory(directory: string): void {
  fs.readdirSync(directory).forEach((file) => {
    const filePath = path.join(directory, file);
    if (fs.statSync(filePath).isDirectory()) traverseDirectory(filePath);
    else if (path.extname(filePath) === '.json') tryOverridingABI(filePath);
  });
}

function tryOverridingABI(filePath: string): void {
  const data = fs.readFileSync(filePath);
  const content = JSON.parse(data.toString());

  if (Array.isArray(content.abi)) {
    content.abi.forEach((item: any, i: number) => {
      if (shouldOverwriteItem(item)) {
        content.abi[i] = Object.assign({}, item, { stateMutability: 'view' });
      }
    });

    fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
  }
}

function shouldOverwriteItem(item: any): boolean {
  const { type, name, stateMutability } = item;
  if (!type || !name || !stateMutability) return false;
  return type === 'function' && stateMutability === 'nonpayable' && FUNCTIONS.includes(name);
}

export default override;
