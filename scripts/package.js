'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function packagePlugin(sourceDir, outputFile) {
  const root = path.resolve(sourceDir);
  const manifestPath = path.join(root, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found in ${root}`);
  }

  const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw);

  if (manifest.tmApi !== 1) {
    throw new Error('tmApi must be 1');
  }

  const filesMap = {};
  for (const file of manifest.files) {
    const filePath = path.join(root, file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Declared file missing: ${file}`);
    }
    const content = fs.readFileSync(filePath);
    filesMap[file] = content.toString('base64');
  }

  const packageObj = {
    format: 2,
    manifest,
    files: filesMap
  };

  const jsonStr = JSON.stringify(packageObj);
  const buffer = Buffer.from(jsonStr, 'utf8');
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');

  fs.writeFileSync(path.resolve(outputFile), buffer);
  console.log(`Successfully packaged: ${manifest.id}@${manifest.version}`);
  console.log(`Package file: ${outputFile}`);
  console.log(`SHA-256: ${hash}`);
  console.log(`Size: ${(buffer.length / 1024).toFixed(2)} KiB`);
  return { hash, buffer };
}

if (require.main === module) {
  const [src, out] = process.argv.slice(2);
  const source = src || path.resolve(__dirname, '../onebot-monitor');
  const output = out || path.resolve(__dirname, '../onebot-monitor.tmplugin');
  packagePlugin(source, output);
}

module.exports = { packagePlugin };
