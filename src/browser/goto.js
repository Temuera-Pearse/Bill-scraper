const log = require('../logger')

async function gotoWithRetry(page, url, opts = {}, tries = 3) {
  const { mode = 'generic' } = opts // 'list' | 'detail' | 'generic'
  let lastErr

  for (let i = 1; i <= tries; i++) {
    try {
      await page.goto(url, {
        waitUntil: ['domcontentloaded', 'networkidle2'],
        timeout: 60000,
      })
      await new Promise((r) => setTimeout(r, 1200))

      await page.waitForSelector('main, #main, #app, [role="main"], article', {
        timeout: 60000,
      })

      if (mode === 'list') {
        await page.waitForFunction(
          () =>
            Array.from(document.querySelectorAll('a[href]')).some((a) =>
              /\/v\/\d+\/[a-z0-9-]+/i.test(
                a.getAttribute('href') || a.href || ''
              )
            ),
          { timeout: 60000 }
        )
      } else if (mode === 'detail') {
        await page.waitForFunction(
          () => !!document.querySelector('h1, h1 span'),
          { timeout: 60000 }
        )
      }

      await new Promise((r) => setTimeout(r, 400))
      return
    } catch (err) {
      lastErr = err
      log.warn(`goto attempt ${i}/${tries} failed: ${err.message}`)
      await page.waitForTimeout(1500 * i)
    }
  }
  throw lastErr
}

module.exports = { gotoWithRetry }
