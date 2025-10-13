const fs = require('fs')
const puppeteer = require('puppeteer')
const { HEADLESS, PUPPETEER_EXECUTABLE_PATH } = require('../config')
const log = require('../logger')

async function launchBrowser() {
  const candidates = [
    PUPPETEER_EXECUTABLE_PATH,
    '/Applications/Opera GX.app/Contents/MacOS/Opera GX',
    `${process.env.HOME}/Applications/Opera GX.app/Contents/MacOS/Opera GX`,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]

  let executablePath
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      executablePath = p
      break
    }
  }

  const usingOpera = !!executablePath && /Opera GX/i.test(executablePath)
  const headless = usingOpera
    ? false
    : String(HEADLESS).toLowerCase() === 'false'
    ? false
    : 'new'

  log.info('Browser pick:', executablePath || 'Bundled Chromium')
  log.info('Headless mode:', headless)

  try {
    log.info('Launching browser (pipe transport)…')
    return await puppeteer.launch({
      headless,
      executablePath,
      pipe: true,
      dumpio: false, // set to true if you want verbose browser logs
      protocolTimeout: 120000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    })
  } catch (e) {
    log.warn('Pipe launch failed, retrying with WebSocket…', e.message)
    return await puppeteer.launch({
      headless,
      executablePath,
      dumpio: false,
      protocolTimeout: 120000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--remote-debugging-port=0',
      ],
    })
  }
}

module.exports = { launchBrowser }
