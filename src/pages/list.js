const { gotoWithRetry } = require('../browser/goto')
const log = require('../logger')
const { sleep } = require('../utils/text')

async function autoLoadAll(page, { maxLoops = 30, debug = false } = {}) {
  let prevHeight = 0
  let stableCount = 0
  for (let i = 0; i < maxLoops; i++) {
    const height = await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight)
      return document.body.scrollHeight
    })
    if (debug) log.info(`[autoLoadAll] loop=${i} height=${height}`)
    if (height === prevHeight) {
      stableCount++
      if (stableCount >= 3) break
    } else {
      stableCount = 0
      prevHeight = height
    }
    await sleep(500)
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
async function clickNextPage(page, opts = {}) {
  const { debug = false, waitMs = 15000 } = opts
  if (debug) log.info(`[clickNextPage] Start URL: ${page.url()}`)
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

  if (debug) log.info(`[clickNextPage] Hrefs before: ${before.length}`)

  // Ensure paginator is visible
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight - 200)
  })
  await new Promise((r) => setTimeout(r, 150))

  // Prefer the test-ref button
  let handle = await page.$('button[data-test-ref="btn-next-page"]')

  // Fallback: any button that looks like "Next"
  if (!handle) {
    handle = await page.$x(
      `//button[normalize-space()[starts-with(translate(., 'NEXT', 'next'), 'next')]]`
    )
    if (handle && Array.isArray(handle)) handle = handle[0]
  }
  if (!handle) {
    if (debug) log.info('[clickNextPage] Next button not found.')
    return false
  }

  // Abort if disabled
  const disabled = await page.evaluate(
    (btn) => !!(btn.disabled || btn.getAttribute('aria-disabled') === 'true'),
    handle
  )
  if (disabled) {
    if (debug) log.info('[clickNextPage] Next button disabled.')
    return false
  }

  // Scroll into view and click with real events
  await handle.evaluate((btn) => btn.scrollIntoView({ block: 'center' }))
  try {
    await handle.click({ delay: 10 })
    if (debug) log.info('[clickNextPage] Clicked Next.')
  } catch {
    // Some UIs need a bounding-box click
    const box = await handle.boundingBox()
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
        delay: 10,
      })
      if (debug) log.info('[clickNextPage] Fallback mouse click used.')
    } else {
      await page.evaluate((btn) => btn.click(), handle)
      if (debug) log.info('[clickNextPage] Fallback DOM click used.')
    }
  }

  // Wait for the bill list to change (new href appears that wasn't in 'before')
  try {
    await page.waitForFunction(
      (prev) => {
        const hrefs = Array.from(document.querySelectorAll('a[href]'))
          .map((a) => a.getAttribute('href') || a.href || '')
          .filter((h) => /\/v\/\d+\/[a-z0-9-]+/i.test(h))
        if (hrefs.length > prev.length) return true
        const prevSet = new Set(prev)
        return hrefs.some((h) => !prevSet.has(h))
      },
      { timeout: waitMs },
      before
    )
    if (debug) log.info('[clickNextPage] Detected new bill links.')
    return true
  } catch {
    // Give it a moment; some SPAs resolve after animation
    await new Promise((r) => setTimeout(r, 1000))
    const after = await page.$$eval('a[href]', (as) =>
      Array.from(
        new Set(
          as
            .map((a) => a.getAttribute('href') || a.href || '')
            .filter((h) => /\/v\/\d+\/[a-z0-9-]+/i.test(h))
        )
      )
    )
    const prevSet = new Set(before)
    const added = after.filter((h) => !prevSet.has(h)).length
    if (debug)
      log.info(
        `[clickNextPage] Post-wait added links: ${added}; End URL: ${page.url()}`
      )
    return added > 0
  }
}

module.exports = {
  autoLoadAll,
  collectBillLinks,
  getNextPageUrl,
  gotoWithRetry,
  clickNextPage,
}
