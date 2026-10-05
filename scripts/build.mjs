import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { copyFonts } from './fonts.mjs';
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('public', 'dist', { recursive: true });
copyFonts('dist/fonts');
const qr = readFileSync('node_modules/qrcode-generator/dist/qrcode.js', 'utf8');
writeFileSync('dist/qrcode.js', qr);
console.log('Built delightful-live: static app + Vercel /api functions.');
