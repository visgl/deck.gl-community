import {cp, mkdir, rm} from 'fs/promises';
import {fileURLToPath} from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

await rm(distDir, {recursive: true, force: true});
await mkdir(distDir, {recursive: true});
await cp(srcDir, distDir, {recursive: true});
