import { nodeResolve } from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';
import pkg from './package.json';

const external = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.peerDependencies)];

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
