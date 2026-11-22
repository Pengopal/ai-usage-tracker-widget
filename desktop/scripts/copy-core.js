// Copies the shared core (../core/src) into src/core so the app and its
// installer carry it. Runs before start, test and every build; src/core is
// generated and git-ignored, so edit core/src instead.
const fs = require('fs');
const path = require('path');

const from = path.join(__dirname, '..', '..', 'core', 'src');
const to = path.join(__dirname, '..', 'src', 'core');

fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
fs.writeFileSync(path.join(to, 'README.md'), 'Generated from core/src by scripts/copy-core.js. Do not edit here.\n');
