import fs from 'fs';
import path, { extname } from 'path';
import { BuildInfo, CompilerOutputContract } from 'hardhat/types';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import logger from './logger';
import Verifier from './verifier';
import { deploy, instanceAt } from './contracts';

import {
  NETWORKS,
  Network,
  Libraries,
  Artifact,
  Input,
  Output,
  Param,
  RawInputKeyValue,
  RawOutput,
  TaskRunOptions,
} from './types';

const TASKS_DIRECTORY = path.resolve(__dirname, '../tasks');

export enum TaskMode {
  LIVE, // Deploys and saves outputs
  TEST, // Deploys but saves to test output
  READ_ONLY, // Does not deploy
}

/* eslint-disable @typescript-eslint/no-var-requires */

export default class Task {
  id: string;
  mode: TaskMode;

  _network?: Network;
  _verifier?: Verifier;

  constructor(id: string, mode: TaskMode, network?: Network, verifier?: Verifier) {
    if (network && !NETWORKS.includes(network)) throw Error(`Unknown network ${network}`);
    this.id = id;
    this.mode = mode;
    this._network = network;
    this._verifier = verifier;
  }

  get network(): string {
    if (!this._network) throw Error('No network defined');
    return this._network;
  }

  set network(name: Network) {
    this._network = name;
  }

  async instanceAt(name: string, address: string): Promise<Contract> {
    return instanceAt(this.artifact(name), address);
  }

  async deployedInstance(name: string): Promise<Contract> {
    const address = this.output()[name];
    if (!address) throw Error(`Could not find deployed address for ${name}`);
    return this.instanceAt(name, address);
  }

  async inputInstance(artifactName: string, inputName: string): Promise<Contract> {
    const rawInput = this.rawInput();
    const input = rawInput[inputName];
    if (!this._isTask(input)) throw Error(`Cannot access to non-task input ${inputName}`);
    const task = input as Task;
    task.network = this.network;
    const address = this._parseRawInput(rawInput)[inputName];
    return task.instanceAt(artifactName, address);
  }

  async deployAndVerify(
    name: string,
    args: Array<Param> = [],
    from?: SignerWithAddress,
    force?: boolean,
    libs?: Libraries
  ): Promise<Contract> {
    const output = this.output({ ensure: false });
    if (force || !output[name]) {
      const instance = await this.deploy(name, args, from, libs);
      await this.verify(name, instance.address, args, libs);
      return instance;
    } else {
      logger.info(`${name} already deployed at ${output[name]}`);
      await this.verify(name, output[name], args, libs);
      return this.instanceAt(name, output[name]);
    }
  }

  async deploy(name: string, args: Array<Param> = [], from?: SignerWithAddress, libs?: Libraries): Promise<Contract> {
    if (this.mode !== TaskMode.LIVE && this.mode !== TaskMode.TEST) {
      throw Error(`Cannot deploy in tasks of mode ${TaskMode[this.mode]}`);
    }

    const instance = await deploy(this.artifact(name), args, from, libs);
    this.save({ [name]: instance });
    logger.success(`Deployed ${name} at ${instance.address}`);
    return instance;
  }

  async verify(
    name: string,
    address: string,
    constructorArguments: string | unknown[],
    libs?: Libraries
  ): Promise<void> {
    if (this.mode !== TaskMode.LIVE) {
      return;
    }

    try {
      if (!this._verifier) return logger.warn('Skipping contract verification, no verifier defined');
      const url = await this._verifier.call(this, name, address, constructorArguments, libs);
      logger.success(`Verified contract ${name} at ${url}`);
    } catch (error) {
      logger.error(`Failed trying to verify ${name} at ${address}: ${error}`);
    }
  }

  async run(options: TaskRunOptions = {}): Promise<void> {
    const taskPath = this._fileAt(this.dir(), 'index.ts');
    const task = require(taskPath).default;
    await task(this, options);
  }

  dir(): string {
    if (!this.id) throw Error('Please provide a task deployment ID to run');
    return this._dirAt(TASKS_DIRECTORY, this.id);
  }

  buildInfo(fileName: string): BuildInfo {
    const buildInfoDir = this._dirAt(this.dir(), 'build-info');
    const artifactFile = this._fileAt(buildInfoDir, `${extname(fileName) ? fileName : `${fileName}.json`}`);
    return JSON.parse(fs.readFileSync(artifactFile).toString());
  }

  buildInfos(): Array<BuildInfo> {
    const buildInfoDir = this._dirAt(this.dir(), 'build-info');
    return fs.readdirSync(buildInfoDir).map((fileName) => this.buildInfo(fileName));
  }

  artifact(contractName: string, fileName?: string): Artifact {
    const buildInfoDir = this._dirAt(this.dir(), 'build-info');
    const builds: {
      [sourceName: string]: { [contractName: string]: CompilerOutputContract };
    } = this._existsFile(path.join(buildInfoDir, `${fileName || contractName}.json`))
      ? this.buildInfo(contractName).output.contracts
      : this.buildInfos().reduce((result, info: BuildInfo) => ({ ...result, ...info.output.contracts }), {});

    const sourceName = Object.keys(builds).find((sourceName) =>
      Object.keys(builds[sourceName]).find((key) => key === contractName)
    );

    if (!sourceName) throw Error(`Could not find artifact for ${contractName}`);
    return builds[sourceName][contractName];
  }

  rawInput(): RawInputKeyValue {
    const taskInputPath = this._fileAt(this.dir(), 'input.ts');
    const rawInput = require(taskInputPath).default;
    const globalInput = { ...rawInput };
    NETWORKS.forEach((network) => delete globalInput[network]);
    const networkInput = rawInput[this.network] || {};
    return { ...globalInput, ...networkInput };
  }

  input(): Input {
    return this._parseRawInput(this.rawInput());
  }

  output({ ensure = true, network }: { ensure?: boolean; network?: Network } = {}): Output {
    if (network === undefined) {
      network = this.mode !== TaskMode.TEST ? this.network : 'test';
    }

    const taskOutputDir = this._dirAt(this.dir(), 'output', ensure);
    const taskOutputFile = this._fileAt(taskOutputDir, `${network}.json`, ensure);
    return this._read(taskOutputFile);
  }

  save(output: RawOutput): void {
    const taskOutputDir = this._dirAt(this.dir(), 'output', false);
    if (!fs.existsSync(taskOutputDir)) fs.mkdirSync(taskOutputDir);

    const outputFile = this.mode === TaskMode.LIVE ? `${this.network}.json` : 'test.json';
    const taskOutputFile = this._fileAt(taskOutputDir, outputFile, false);
    const previousOutput = this._read(taskOutputFile);

    const finalOutput = { ...previousOutput, ...this._parseRawOutput(output) };
    this._write(taskOutputFile, finalOutput);
  }

  private _parseRawInput(rawInput: RawInputKeyValue): Input {
    return Object.keys(rawInput).reduce((input: Input, key: Network | string) => {
      const item = rawInput[key];

      if (!this._isTask(item)) {
        // Non-task inputs are simply their value
        input[key] = item;
      } else {
        // For task inputs, we query the output file with the name of the key in the input object. For example, given
        // { 'BalancerHelpers': new Task('20210418-vault', TaskMode.READ_ONLY) }
        // the input value will be the output of name 'BalancerHelpers' of said task.
        const task = item as Task;
        const output = task.output({ network: this.network });

        if (output[key] === undefined) {
          throw Error(`No '${key}' value for task ${task.id} in output of network ${this.network}`);
        }

        input[key] = output[key];
      }

      return input;
    }, {});
  }

  private _parseRawOutput(rawOutput: RawOutput): Output {
    return Object.keys(rawOutput).reduce((output: Output, key: string) => {
      const value = rawOutput[key];
      output[key] = typeof value === 'string' ? value : value.address;
      return output;
    }, {});
  }

  private _read(path: string): Output {
    return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path).toString()) : {};
  }

  private _write(path: string, output: Output): void {
    const timestamp = new Date().getTime();
    const finalOutputJSON = JSON.stringify({ ...output, timestamp }, null, 2);
    fs.writeFileSync(path, finalOutputJSON);
  }

  private _fileAt(base: string, name: string, ensure = true): string {
    const filePath = path.join(base, name);
    if (ensure && !this._existsFile(filePath)) throw Error(`Could not find a file at ${filePath}`);
    return filePath;
  }

  private _dirAt(base: string, name: string, ensure = true): string {
    const dirPath = path.join(base, name);
    if (ensure && !this._existsDir(dirPath)) throw Error(`Could not find a directory at ${dirPath}`);
    return dirPath;
  }

  private _existsFile(filePath: string): boolean {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  }

  private _existsDir(dirPath: string): boolean {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _isTask(object: any): boolean {
    return object.constructor.name == 'Task';
  }
}
