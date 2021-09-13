import fs from 'fs';
import path, { extname } from 'path';
import { BuildInfo, CompilerOutputContract, HardhatRuntimeEnvironment } from 'hardhat/types';
import { BigNumber, Contract } from 'ethers';
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

/* eslint-disable @typescript-eslint/no-var-requires */

export default class Task {
  id: string;
  _network?: Network;
  _verifier?: Verifier;
  _outputFile?: string;

  static fromHRE(id: string, hre: HardhatRuntimeEnvironment, verifier?: Verifier): Task {
    return new this(id, hre.network.name, verifier);
  }

  static forTest(id: string, network: Network, outputTestFile = 'test'): Task {
    const task = new this(id, network);
    task.outputFile = outputTestFile;
    return task;
  }

  constructor(id: string, network?: Network, verifier?: Verifier) {
    if (network && !NETWORKS.includes(network)) throw Error(`Unknown network ${network}`);
    this.id = id;
    this._network = network;
    this._verifier = verifier;
  }

  get outputFile(): string {
    return `${this._outputFile || this.network}.json`;
  }

  set outputFile(file: string) {
    this._outputFile = file;
  }

  get network(): string {
    if (!this._network) throw Error('A network must be specified to define a task');
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
      this.save({ [name]: instance });
      await this.verify(name, instance.address, args, libs);
      return instance;
    } else {
      logger.info(`${name} already deployed at ${output[name]}`);
      await this.verify(name, output[name], args, libs);
      return this.instanceAt(name, output[name]);
    }
  }

  async deploy(name: string, args: Array<Param> = [], from?: SignerWithAddress, libs?: Libraries): Promise<Contract> {
    const instance = await deploy(this.artifact(name), args, from, libs);
    logger.success(`Deployed ${name} at ${instance.address}`);
    return instance;
  }

  async verify(
    name: string,
    address: string,
    constructorArguments: string | unknown[],
    libs?: Libraries
  ): Promise<void> {
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
    if (network) this.network = network;
    const taskOutputDir = this._dirAt(this.dir(), 'output', ensure);
    const taskOutputFile = this._fileAt(taskOutputDir, this.outputFile, ensure);
    return this._read(taskOutputFile);
  }

  save(output: RawOutput): void {
    const taskOutputDir = this._dirAt(this.dir(), 'output', false);
    if (!fs.existsSync(taskOutputDir)) fs.mkdirSync(taskOutputDir);

    const taskOutputFile = this._fileAt(taskOutputDir, this.outputFile, false);
    const previousOutput = this._read(taskOutputFile);

    const finalOutput = { ...previousOutput, ...this._parseRawOutput(output) };
    this._write(taskOutputFile, finalOutput);
  }

  delete(): void {
    const taskOutputDir = this._dirAt(this.dir(), 'output');
    const taskOutputFile = this._fileAt(taskOutputDir, this.outputFile);
    fs.unlinkSync(taskOutputFile);
  }

  private _parseRawInput(rawInput: RawInputKeyValue): Input {
    return Object.keys(rawInput).reduce((input: Input, key: Network | string) => {
      const item = rawInput[key];
      if (Array.isArray(item)) input[key] = item;
      else if (BigNumber.isBigNumber(item)) input[key] = item;
      else if (typeof item !== 'object') input[key] = item;
      else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const output: Output | any = this._isTask(item) ? (item as Task).output({ network: this.network }) : item;
        input[key] = output[key] ? output[key] : output;
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
