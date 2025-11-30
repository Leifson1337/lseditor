const fs = require('fs');
const path = require('path');

const filesToCopy = ['preload.js', 'logo.png'];
const distDir = path.join(__dirname, 'dist');

filesToCopy.forEach(file => {
  const source = path.join(__dirname, file);
  const destination = path.join(distDir, file);
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, destination);
    console.log(`${file} copied to dist/${file}`);
  }
});
