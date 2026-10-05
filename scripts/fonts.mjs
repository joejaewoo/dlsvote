import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function copyFonts(destination) {
  const css = readFileSync('public/fonts/index.css', 'utf8');
  const files = [...css.matchAll(/url\(\.\/files\/([a-z0-9-]+\.woff2)\)/g)].map(match => match[1]);
  mkdirSync(join(destination, 'files'), { recursive: true });
  for (const file of files) cpSync(join('node_modules/@fontsource-variable/noto-sans-kr/files', file), join(destination, 'files', file));
}
