// Dependency-free console bundle. No minification: the entire script stays auditable.
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
fs.writeFileSync(path.join(__dirname, 'console-sender.js'),
  '/* UCB Eyes console sender. Paste this ENTIRE file in DevTools Console > top. */\n' +
  '/* No HAR, cookies, UCB credentials, source HTML or screenshots are uploaded. */\n' +
  '(function () {\n' + read('ucb-core.js') + '\n' + read('public-feed.js') + '\n' + read('src/sender.js') + '\n})();\n');
console.log('Built console-sender.js');
