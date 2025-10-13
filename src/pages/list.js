const { gotoWithRetry } = require('../browser/goto')

async function autoLoadAll(page) {
  let prevHeight = 0
  for (let i = 0; i < 30; i++) {
    const height = await page.evaluate('document.body.scrollHeight')
    if (height === prevHeight) {
      const clicked = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button, a')).find(
          (el) => /load more|show more|more bills/i.test(el.textContent || '')
        )
        if (btn) {
          btn.click()
          return true
        }
        return false
      })
      if (!clicked) break
      await page
        .waitForNetworkIdle({ idleTime: 1000, timeout: 15000 })
        .catch(() => {})
    } else {
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
      await page.waitForTimeout(700)
      prevHeight = height
    }
  }
}

async function collectBillLinks(page) {
  const links = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href]'))
    const urls = anchors
      .map((a) => a.getAttribute('href') || '')
      .map((href) => href.trim())
      .filter(Boolean)
      .filter((href) => /\/v\/\d+\/[a-z0-9-]+/i.test(href))
      .map((href) => new URL(href, location.origin).toString())
    return Array.from(new Set(urls))
  })
  return links
}

async function getNextPageUrl(page) {
  const next = await page.evaluate(() => {
    let el = document.querySelector('a[rel="next"], a[aria-label="Next"]')
    if (!el) {
      el = Array.from(document.querySelectorAll('a,button')).find((e) => {
        const t = (e.textContent || '').trim().toLowerCase()
        const aria = (e.getAttribute('aria-label') || '').trim().toLowerCase()
        return t === 'next' || aria === 'next'
      })
    }
    if (!el) return ''
    const disabled =
      el.getAttribute('aria-disabled') === 'true' ||
      /\bdisabled\b/i.test(el.className || '')
    if (disabled) return ''
    return el.getAttribute('href') || el.href || ''
  })

  if (!next) return null
  try {
    return new URL(next, page.url()).toString()
  } catch {
    return null
  }
}

// src/pages/list.js
async function clickNextPage(page) {
  // Snapshot current bill hrefs so we can detect a change after clicking
  const before = await page.$$eval('a[href]', (as) =>
    Array.from(
      new Set(
        as
          .map((a) => a.getAttribute('href') || a.href || '')
          .filter((h) => /\/v\/\d+\/[a-z0-9-]+/i.test(h))
      )
    )
  )

  // Ensure paginator is visible
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight - 200)
  })
  await page.waitForTimeout(150)

  // Prefer the test-ref button
  let handle = await page.$('button[data-test-ref="btn-next-page"]')

  // Fallback: any button that looks like "Next"
  if (!handle) {
    handle = await page.$x(
      `//button[normalize-space()[starts-with(translate(., 'NEXT', 'next'), 'next')]]`
    )
    if (handle && Array.isArray(handle)) handle = handle[0]
  }
  if (!handle) return false

  // Abort if disabled
  const disabled = await page.evaluate(
    (btn) => !!(btn.disabled || btn.getAttribute('aria-disabled') === 'true'),
    handle
  )
  if (disabled) return false

  // Scroll into view and click with real events
  await handle.evaluate((btn) => btn.scrollIntoView({ block: 'center' }))
  try {
    await handle.click({ delay: 10 })
  } catch {
    // Some UIs need a bounding-box click
    const box = await handle.boundingBox()
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
        delay: 10,
      })
    } else {
      await page.evaluate((btn) => btn.click(), handle)
    }
  }

  // Wait for the bill list to change (new href appears that wasn't in 'before')
  try {
    await page.waitForFunction(
      (prev) => {
        const hrefs = Array.from(document.querySelectorAll('a[href]'))
          .map((a) => a.getAttribute('href') || a.href || '')
          .filter((h) => /\/v\/\d+\/[a-z0-9-]+/i.test(h))
        return hrefs.some((h) => !prev.includes(h))
      },
      { timeout: 15000 },
      before
    )
  } catch {
    // Give it a moment; some SPAs resolve after animation
    await page.waitForTimeout(1000)
  }

  return true
}

module.exports = {
  autoLoadAll,
  collectBillLinks,
  getNextPageUrl,
  gotoWithRetry,
  clickNextPage,
}
