const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'preload.js');
const dest = path.join(__dirname, 'dist', 'preload.js');

fs.copyFileSync(src, dest);
console.log('preload.js copied to dist/preload.js');
