import prompts from 'prompts';
import chalk from 'chalk';
import { ethers } from 'hardhat';

import { CliProps } from '../types';

import { mapFunctionInput } from './promptMappings';

const createGetterMethodsCli = (abi: any[]) =>
  async function getterMethodsCli(address: string, cliProps: CliProps): Promise<any> {
    const deployer = (await ethers.getSigners())[0];

    const poolContract = await ethers.getContractAt(abi, address, deployer);

    const { functionName } = await prompts(
      {
        type: 'select',
        name: 'functionName',
        message: 'Select contract function',
        choices: Object.keys(poolContract.interface.functions)
          .filter((contractFunctionName) => {
            const contractFunction = (poolContract.interface.functions as { [key: string]: any })[contractFunctionName];
            return contractFunction.inputs.length === 0;
          })
          .map((contractFunction) => ({
            title: contractFunction,
            value: contractFunction,
          })),
      },
      {
        onCancel: () => {
          return cliProps.parentCli ? cliProps.parentCli(cliProps) : process.exit(0);
        },
      }
    );
    const contractFunction = (poolContract.interface.functions as { [key: string]: any })[functionName];

    const contractFunctionInputs = [];
    for (const input of contractFunction.inputs) {
      const { type, name } = input;
      const inputValue = await mapFunctionInput(type, name);

      contractFunctionInputs.push(inputValue);
    }

    const contractFunctionName = contractFunction.name as string;
    const transactionResult = await (poolContract.functions as any)[contractFunctionName].call(contractFunctionInputs);

    console.log(chalk.bgYellow(chalk.black(contractFunction.name)), chalk.yellow(transactionResult.toString()));

    return getterMethodsCli(address, cliProps);
  };

export default createGetterMethodsCli;
