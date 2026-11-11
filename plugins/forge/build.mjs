import { build } from 'esbuild';
await build({entryPoints:['index.js'],outdir:'lib',bundle:true,platform:'node',target:'node24',format:'esm',packages:'external'});
