#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const pkgDir = path.dirname(__dirname);
const parentDir = path.dirname(pkgDir);
if (!parentDir.endsWith('node_modules')) process.exit(0);
const twilioDir = path.join(parentDir, '@twilio');
fs.mkdirSync(twilioDir, { recursive: true });
for (const name of ['tac-core', 'tac-tools', 'tac-server']) {
  const link = path.join(twilioDir, name);
  const target = path.relative(twilioDir, path.join(pkgDir, 'packages', name.replace('tac-', '')));
  try { fs.rmSync(link, { recursive: true, force: true }); fs.symlinkSync(target, link, 'dir'); } catch (e) {}
}
