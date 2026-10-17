const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../Batchmotion/gefoot-main/src/lib');
for (const name of ['runtime', 'prompt', 'csv']) {
  const source = fs.readFileSync(path.join(root, `${name}.js`), 'utf8');
  fs.writeFileSync(path.join(__dirname, 'dist', `gefoot-${name}.source`), source);
}
