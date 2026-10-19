import { readFile, writeFile } from 'node:fs/promises';
const core = await readFile('src/core.js', 'utf8');
const source = core.replace(/^export const uid = .*\r?\n/m, '').replace(/^export /gm, '');
await writeFile('apps-script/Validation.gs', '// Generated from src/core.js by npm run sync:validation. Do not edit directly.\n' + source);
console.log('Apps Script validation updated.');
