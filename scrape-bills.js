/* eslint-disable no-console */
require('dotenv').config()

const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const puppeteer = require('puppeteer')
const { createObjectCsvWriter } = require('csv-writer')

// ---------- Config ----------
const {
  BILL_SITE_INVOICES_URL = 'https://bills.parliament.nz/bills-proposed-laws?Tab=All',
  DOWNLOAD_DIR = './Bill-tracker/pdfs', // not used for this target but we keep the dir
  HEADLESS = 'true',
  MAX_BILLS, // optional: e.g. 5 for a small first run
  PUPPETEER_EXECUTABLE_PATH, // optional: point to your system Chrome/Opera
} = process.env

const ROOT_DIR = process.cwd()
const DOWNLOADS_DIR = path.resolve(ROOT_DIR, DOWNLOAD_DIR)
const CSV_PATH = path.resolve(ROOT_DIR, './Bill-tracker/bills.csv')
// ADD: store the one-page bill text files
const FULLTEXT_DIR = path.resolve(ROOT_DIR, './Bill-tracker/fulltext')

// ---------- Global error guards ----------
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err)
  process.exit(1)
})
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err)
  process.exit(1)
})

// ---------- Utilities ----------
async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true })
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

async function gotoWithRetry(page, url, tries = 3) {
  let lastErr
  for (let i = 1; i <= tries; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })

      // Give the Blazor app a moment to boot
      await page.waitForTimeout(1500)

      // Wait for the main app container to exist (broad selectors)
      await page.waitForSelector('main, #main, #app, [role="main"]', {
        timeout: 60000,
      })

      // Now wait until bill links actually exist (the SPA has rendered them)
      await page.waitForFunction(
        () =>
          Array.from(document.querySelectorAll('a[href]')).some((a) =>
            /\/v\/\d+\/[a-z0-9-]+/i.test(a.getAttribute('href') || a.href || '')
          ),
        { timeout: 60000 }
      )

      // One extra beat for late renders
      await page.waitForTimeout(500)
      return
    } catch (err) {
      lastErr = err
      console.warn(`goto attempt ${i}/${tries} failed: ${err.message}`)
      await page.waitForTimeout(1500 * i)
    }
  }
  throw lastErr
}

// ADD: helpers for filenames and snippets
function sanitizeFilename(name) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}
function snippet(text, max = 400) {
  return (text || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

// ---------- Site helpers (Parliament bills) ----------
async function autoLoadAll(page) {
  // Scroll to bottom repeatedly and try a generic "load/show more" button if present.
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

// REPLACE: collectBillLinks with a robust version
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
  console.log('Sample bill links:', links.slice(0, 5))
  return links
}

async function scrapeBillPage(page, url) {
  await gotoWithRetry(page, url)

  // Title
  const title = await page.evaluate(() => {
    const h1 = document.querySelector('h1, h1 span')
    return h1 ? h1.textContent.trim() : ''
  })

  // Text sweep for labels
  const fullText = await page.evaluate(() => document.body.innerText || '')

  const billNo = (fullText.match(/Bill No\.?\s*([A-Za-z0-9\-]+)/i) || [, ''])[1]
  const parliament = (fullText.match(/\b(\d{2})\s+Parliament\b/) || [, ''])[1]

  const mpInCharge = (fullText.match(/MP in charge\s*([\s\S]*?)(?:\n|$)/i) || [
    ,
    '',
  ])[1].trim()
  const committee = (fullText.match(/Committee\s*([\s\S]*?)(?:\n|$)/i) || [
    ,
    '',
  ])[1].trim()

  const nzLegislationUrl = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((el) =>
      /legislation\.govt\.nz/i.test(el.href || '')
    )
    return a ? a.href : ''
  })

  // A short summary/snippet (best effort)
  const summarySnippet = await page.evaluate(() => {
    const el = document.querySelector(
      '[data-testid*="summary"], [class*="summary"], main'
    )
    return el ? el.innerText.slice(0, 800) : ''
  })

  return {
    title,
    billNo,
    parliament,
    mpInCharge,
    committee,
    billUrl: url,
    nzLegislationUrl,
    summarySnippet: (summarySnippet || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 250),
  }
}

// ADD: scrape bill detail (parliament site) and follow to legislation.govt.nz "View whole"
async function scrapeBillDetail(page, billUrl) {
  await gotoWithRetry(page, billUrl)
  const title = await page.evaluate(() => {
    const h1 = document.querySelector('h1, h1 span')
    return h1 ? h1.textContent.trim() : ''
  })
  const fullText = await page.evaluate(() => document.body.innerText || '')
  const billNo = (fullText.match(/Bill No\.?\s*([A-Za-z0-9\-]+)/i) || [, ''])[1]
  const parliament = (fullText.match(/\b(\d{2})\s+Parliament\b/) || [, ''])[1]
  const mpInCharge = (fullText.match(/MP in charge\s*([\s\S]*?)(?:\n|$)/i) || [
    ,
    '',
  ])[1].trim()
  const committee = (fullText.match(/Committee\s*([\s\S]*?)(?:\n|$)/i) || [
    ,
    '',
  ])[1].trim()
  const readBillUrl = await page.evaluate(() => {
    const el =
      document.querySelector('a[href*="legislation.govt.nz/bill"]') ||
      Array.from(document.querySelectorAll('a[href]')).find((a) =>
        /read\s+the\s+bill/i.test(a.textContent || '')
      )
    return el
      ? new URL(el.getAttribute('href') || el.href, location.href).toString()
      : ''
  })
  return {
    title,
    billNo,
    parliament,
    mpInCharge,
    committee,
    billUrl,
    readBillUrl,
  }
}

async function openViewWholeAndGetText(page, legislationUrl) {
  if (!legislationUrl) return { viewWholeUrl: '', fullText: '' }
  await gotoWithRetry(page, legislationUrl)
  let viewWholeUrl = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href]'))
    const byText = anchors.find((a) => /view whole/i.test(a.textContent || ''))
    if (byText) return byText.href || byText.getAttribute('href')
    const byHref = anchors.find((a) =>
      /whole/i.test(a.getAttribute('href') || '')
    )
    return byHref ? byHref.href || byHref.getAttribute('href') : ''
  })
  if (viewWholeUrl) {
    // Ensure absolute URL based on current page
    try {
      viewWholeUrl = new URL(viewWholeUrl, page.url()).toString()
    } catch {}
    await gotoWithRetry(page, viewWholeUrl)
  } else {
    viewWholeUrl = page.url()
  }
  const fullText = await page.evaluate(() => {
    const candidates = [
      '#mainContent',
      '#content',
      'main',
      'article',
      '.content',
      '#documentContent',
    ]
    for (const sel of candidates) {
      const el = document.querySelector(sel)
      if (el && (el.innerText || '').trim().length > 800) return el.innerText
    }
    return document.body ? document.body.innerText : ''
  })
  return { viewWholeUrl: page.url(), fullText }
}

// ADD: pagination helper to find the "Next" page
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

// ---------- Main ----------
;(async () => {
  console.log('NZ Parliament Bill Scraper starting...')
  await ensureDir(DOWNLOADS_DIR)
  await ensureDir(path.dirname(CSV_PATH))
  // ADD: ensure fulltext directory exists
  await ensureDir(FULLTEXT_DIR)

  // ---- Browser selection (auto-detect) ----
  const candidates = [
    PUPPETEER_EXECUTABLE_PATH, // user-specified
    '/Applications/Opera GX.app/Contents/MacOS/Opera GX', // system Opera GX
    `${process.env.HOME}/Applications/Opera GX.app/Contents/MacOS/Opera GX`, // user Opera GX
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // system Chrome (if reinstalled later)
  ]

  let executablePath = undefined
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      executablePath = p
      break
    }
  }

  const usingOpera = !!executablePath && /Opera GX/i.test(executablePath)

  // Prefer visible for Opera GX; otherwise use modern headless unless HEADLESS=false
  const headless = usingOpera
    ? false
    : String(HEADLESS).toLowerCase() === 'false'
    ? false
    : 'new'

  console.log(
    'Browser pick:',
    executablePath ? executablePath : 'Bundled Chromium'
  )
  console.log('Headless mode:', headless)

  // ---- Robust launch: try PIPE first, then WebSocket fallback ----
  async function launchBrowser() {
    try {
      console.log('Launching browser (pipe transport)…')
      return await puppeteer.launch({
        headless,
        executablePath,
        pipe: true, // <— avoids DevTools WebSocket flakiness
        dumpio: true, // show browser stderr if something goes wrong
        protocolTimeout: 120000,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      })
    } catch (e) {
      console.warn('Pipe launch failed, retrying with WebSocket…', e.message)
      return await puppeteer.launch({
        headless,
        executablePath,
        dumpio: true,
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

  const browser = await launchBrowser()
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 1600 })
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  )
  page.setDefaultTimeout(60000)

  let scrapedCount = 0
  const results = []

  try {
    // REPLACE: list/loop with paginated loop from Current tab
    console.log('Navigating to bills list (Current tab)…')
    await gotoWithRetry(page, BILL_SITE_INVOICES_URL)
    page.setDefaultTimeout(1000)

    const maxBills = Number(process.env.MAX_BILLS || 0) // 0 = no cap
    const seen = new Set()
    let pageIndex = 1

    outer: while (true) {
      console.log(`\n--- Page ${pageIndex} ---`)
      let pageLinks = await collectBillLinks(page)
      pageLinks = pageLinks.filter((u) => !seen.has(u))
      console.log(`Found ${pageLinks.length} bill links on page ${pageIndex}.`)
      if (!pageLinks.length) {
        const snap = await page.evaluate(() =>
          (document.body.innerText || '').slice(0, 1000)
        )
        console.warn('No bill links found on this page. Snapshot:\n', snap)
      }

      for (let i = 0; i < pageLinks.length; i++) {
        if (maxBills && scrapedCount >= maxBills) break outer
        const billUrl = pageLinks[i]
        seen.add(billUrl)

        try {
          console.log(
            `Scraping [${scrapedCount + 1}${
              maxBills ? '/' + maxBills : ''
            }] ${billUrl}`
          )
          const base = await scrapeBillDetail(page, billUrl)

          let viewWholeUrl = ''
          let fullText = ''
          if (base.readBillUrl) {
            const vw = await openViewWholeAndGetText(page, base.readBillUrl)
            viewWholeUrl = vw.viewWholeUrl
            fullText = vw.fullText
          }

          let fullTextPath = ''
          if (fullText && fullText.length > 0) {
            const name = sanitizeFilename(
              base.billNo || base.title || `bill_${scrapedCount + 1}`
            )
            const filePath = path.join(FULLTEXT_DIR, `${name}.txt`)
            await fsp.writeFile(filePath, fullText, 'utf8')
            fullTextPath = filePath
          }

          results.push({
            title: base.title,
            billNo: base.billNo,
            parliament: base.parliament,
            mpInCharge: base.mpInCharge,
            committee: base.committee,
            billUrl: base.billUrl,
            readBillUrl: base.readBillUrl,
            viewWholeUrl,
            fullTextPath,
            summarySnippet: snippet(fullText, 400),
            error: '',
          })

          scrapedCount++
          await sleep(250)
        } catch (err) {
          console.warn(`Failed ${billUrl}: ${err.message}`)
          results.push({
            title: '',
            billNo: '',
            parliament: '',
            mpInCharge: '',
            committee: '',
            billUrl,
            readBillUrl: '',
            viewWholeUrl: '',
            fullTextPath: '',
            summarySnippet: '',
            error: err.message,
          })
        }
      }

      const nextUrl = await getNextPageUrl(page)
      if (!nextUrl) {
        console.log('No Next page found (or disabled). Pagination complete.')
        break
      }
      console.log(`Going to Next page: ${nextUrl}`)
      await gotoWithRetry(page, nextUrl)
      pageIndex++
    }

    // REPLACE: CSV header with new columns
    console.log(`Writing CSV to ${CSV_PATH}…`)
    const csvWriter = createObjectCsvWriter({
      path: CSV_PATH,
      header: [
        { id: 'title', title: 'title' },
        { id: 'billNo', title: 'billNo' },
        { id: 'parliament', title: 'parliament' },
        { id: 'mpInCharge', title: 'mpInCharge' },
        { id: 'committee', title: 'committee' },
        { id: 'billUrl', title: 'billUrl' },
        { id: 'readBillUrl', title: 'readBillUrl' },
        { id: 'viewWholeUrl', title: 'viewWholeUrl' },
        { id: 'fullTextPath', title: 'fullTextPath' },
        { id: 'summarySnippet', title: 'summarySnippet' },
        { id: 'error', title: 'error' },
      ],
      alwaysQuote: true,
    })
    await csvWriter.writeRecords(results)
    console.log('CSV saved at:', CSV_PATH)

    console.log(`Success. Scraped ${scrapedCount} bills.`)
  } catch (err) {
    console.error('Fatal error:', err)
  } finally {
    await browser.close()
    console.log('Browser closed. Done.')
  }
})()
