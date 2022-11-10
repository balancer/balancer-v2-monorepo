import { nodeResolve } from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';
import fs from 'fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const external = [
  '@ethersproject/abi',
  '@ethersproject/abstract-signer',
  '@ethersproject/address',
  '@ethersproject/bignumber',
  '@ethersproject/bytes',
  '@ethersproject/constants',
  '@ethersproject/contracts',
];

export default [
  {
    input: 'src/index.ts',
    output: [
      {
        name: 'balancer-js',
        file: pkg.browser,
        format: 'umd',
        sourcemap: true,
      },
      { file: pkg.main, format: 'cjs', sourcemap: true },
      { file: pkg.module, format: 'es', sourcemap: true },
    ],
    plugins: [nodeResolve(), typescript()],
    external,
  },
  {
    input: 'src/index.ts',
    output: [{ file: 'dist/index.d.ts', format: 'es' }],
    plugins: [dts()],
  },
];
