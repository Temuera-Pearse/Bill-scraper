const fs = require('fs')
const fsp = fs.promises

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true })
}

async function writeText(filePath, text) {
  await ensureDir(require('path').dirname(filePath))
  await fsp.writeFile(filePath, text, 'utf8')
}

module.exports = { ensureDir, writeText }
