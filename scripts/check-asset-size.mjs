#!/usr/bin/env node
/**
 * Fail if any file under apps/web/dist exceeds Cloudflare Pages 25 MiB limit.
 */
import fs from 'node:fs';
import path from 'node:path';

const LIMIT = 25 * 1024 * 1024;
const root = path.resolve('apps/web/dist');

if (!fs.existsSync(root)) {
  console.error('dist/ missing — run npm run build first');
  process.exit(1);
}

/** @type {string[]} */
const overs = [];
let count = 0;

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else {
      count += 1;
      if (st.size > LIMIT) {
        overs.push(`${(st.size / (1024 * 1024)).toFixed(2)} MiB  ${path.relative(root, p)}`);
      }
    }
  }
}

walk(root);

if (overs.length) {
  console.error('Assets exceed 25 MiB Pages limit:');
  for (const line of overs) console.error('  ' + line);
  process.exit(1);
}

console.log(`OK: ${count} assets, all ≤ 25 MiB`);
