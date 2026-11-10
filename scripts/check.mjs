import { readFile, access, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('Manifest V3 required');
const files = [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page.split('#')[0], ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap(x=>x.js), ...manifest.web_accessible_resources.flatMap(x=>x.resources)];
for (const file of files) await access(`extension/${file}`);
for (const file of await readdir('extension')) if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', `extension/${file}`], { stdio:'inherit' });
for (const html of ['options.html', 'popup.html']) {
  const text = await readFile(`extension/${html}`, 'utf8');
  for (const [, path] of text.matchAll(/(?:src|href)="([^"#]+)"/g)) if (!path.startsWith('http')) await access(`extension/${path}`);
  if (/<script(?![^>]*\bsrc=)/i.test(text) || /\son\w+=/.test(text)) throw new Error(`Inline handlers/scripts prohibited: ${html}`);
}
console.log('Manifest, packaged assets, JavaScript syntax and extension CSP checks passed.');
