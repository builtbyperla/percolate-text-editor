// Generates THIRD-PARTY-NOTICES.txt from the installed production dependency
// tree using npm itself. No separately installed or downloaded license scanner
// is required.
//
// Only production deps are included: devDependencies (vite, vitest, electron
// tooling) never reach a user, so they carry no attribution duty. The demo
// build sets legalComments:'none', which strips notices out of the bundle —
// this file is what carries them instead, so it must ship alongside dist-demo.
//
// Run via `npm run notices`; npm automatically runs it before build:demo, and
// Vite then copies the refreshed file into dist-demo.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(projectRoot, 'THIRD-PARTY-NOTICES.txt');

// npm prints one installed package directory per line. --omit=dev retains the
// complete transitive production tree while excluding build/test tooling.
const packageDirs = execFileSync(
  'npm',
  ['ls', '--omit=dev', '--all', '--parseable'],
  { cwd: projectRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
).trim().split(/\r?\n/).filter((path) => path && path !== projectRoot);

const licenseNames = /^(licen[cs]e|copying)(\..*)?$/i;
const entries = packageDirs.map((packageDir) => {
  const info = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const licenseFile = readdirSync(packageDir).find((name) => licenseNames.test(name));
  return [`${info.name ?? basename(packageDir)}@${info.version}`, info, packageDir, licenseFile];
}).sort(([a], [b]) => a.localeCompare(b));

// These publishers omit a license file from the individual npm tarball. Keep
// their repository-level text locally derivable so offline builds remain
// complete. Unknown future omissions stay loud in the generated notice.
const licenseFallbacks = {
  '@ai-sdk/provider-utils': () => readFileSync(
    join(projectRoot, 'node_modules/@ai-sdk/provider/LICENSE'),
    'utf8',
  ).trim(),
  '@platformos/lang-jsonc': () => `MIT License

Copyright (c) platformOS

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
};

const sections = [];
for (const [id, info, packageDir, licenseFile] of entries) {
  const license = typeof info.license === 'string'
    ? info.license
    : info.license?.type ?? info.licenses?.map((item) => item.type ?? item).join(' OR ') ?? 'UNKNOWN';
  const repository = typeof info.repository === 'string' ? info.repository : info.repository?.url;
  const lines = [id, `License: ${license}`];
  if (info.author) {
    const author = typeof info.author === 'string' ? info.author : info.author.name;
    if (author) lines.push(`Publisher: ${author}`);
  }
  if (repository) lines.push(`Repository: ${repository}`);

  // Reproducing the full text is the actual obligation for MIT/BSD/OFL, not
  // just naming the license. A missing file is loud rather than silent.
  let text = '(License text not found in package.)';
  if (licenseFile) {
    try {
      text = readFileSync(join(packageDir, licenseFile), 'utf8').trim();
    } catch (err) {
      text = `(Could not read license file: ${err.message})`;
    }
  } else if (licenseFallbacks[info.name]) {
    text = licenseFallbacks[info.name]();
  }
  text = text.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '');
  sections.push(`${lines.join('\n')}\n\n${text}`);
}

const divider = `\n\n${'-'.repeat(78)}\n\n`;
const header = [
  'THIRD-PARTY SOFTWARE NOTICES',
  '',
  'This product bundles the following third-party packages. Each is listed',
  'with its license and the full text of that license.',
  '',
  `Generated from the production dependency tree; ${entries.length} packages.`,
].join('\n');

writeFileSync(outFile, `${header}${divider}${sections.join(divider)}\n`, 'utf8');
console.log(`Wrote ${outFile} (${entries.length} packages)`);
