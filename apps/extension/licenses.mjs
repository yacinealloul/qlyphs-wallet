/** Inventory and preserve licenses of actual third-party bundle contributors. */
import { dirname, resolve } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
export async function licenseNotices(metafile, sdkDirectory) {
  const contributors = new Set([sdkDirectory]);
  for (const output of Object.values(metafile.outputs)) {
    for (const [name, input] of Object.entries(output.inputs)) {
      if (!input.bytesInOutput || !name.includes('node_modules/') || name.startsWith('(')) continue;
      let dir = dirname(resolve(name));
      for (;;) {
        try {
          const p = JSON.parse(await readFile(resolve(dir, 'package.json'), 'utf8'));
          if (p.name && p.version) { contributors.add(dir); break; }
        } catch { /* A nested directory need not be a package root. */ }
        const parent = dirname(dir);
        if (parent === dir) throw Error(`Cannot locate package for bundled input: ${name}`);
        dir = parent;
      }
    }
  }
  const entries = [];
  for (const directory of contributors) {
    const p = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
    const names = (await readdir(directory)).filter(n => /^(licen[cs]e|copying|notice)(\.|$)/i.test(n)).sort();
    if (!names.length) throw Error(`Missing bundled dependency license: ${p.name}@${p.version}`);
    const texts = [];
    for (const name of names) {
      const text = await readFile(resolve(directory, name), 'utf8');
      texts.push(`--- ${name} ---\n${text}`);
    }
    entries.push({name:p.name, version:p.version, license:p.license ?? 'See full notice', notice:texts.join('\n')});
  }
  entries.sort((a,b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'));
  return entries.map(p => `=== ${p.name}@${p.version} | ${typeof p.license === 'string' ? p.license : JSON.stringify(p.license)} ===\n${p.notice}`).join('\n\n')+'\n';
}
