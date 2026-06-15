// Copies src/ into dist/. No bundling needed — zero production dependencies.
import { cpSync, rmSync, mkdirSync } from 'fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('src', 'dist', { recursive: true });
console.log('build: copied src/ → dist/');
