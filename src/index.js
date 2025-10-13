/* eslint-disable no-console */
const path = require('path')
const log = require('./logger')
const {
  BILL_SITE_INVOICES_URL,
  DOWNLOAD_DIR,
  CSV_PATH,
  FULLTEXT_DIR,
  MAX_BILLS,
  MAX_PAGES,
} = require('./config')

const { ensureDir, writeText } = require('./utils/files')
const { sleep, sanitizeFilename, snippet } = require('./utils/text')
const { launchBrowser } = require('./browser/launch')
const { gotoWithRetry } = require('./browser/goto')

const {
  autoLoadAll,
  collectBillLinks,
  getNextPageUrl,
  clickNextPage,
} = require('./pages/list')
const { scrapeBillDetail } = require('./pages/billDetail')
const { openViewWholeAndGetText } = require('./pages/legislation')
const { writeBillsCsv } = require('./output/csv')

// ---- Global error guards ----
process.on('unhandledRejection', (err) => {
  log.error('UNHANDLED REJECTION:', err)
  process.exit(1)
})
process.on('uncaughtException', (err) => {
  log.error('UNCAUGHT EXCEPTION:', err)
  process.exit(1)
})
;(async () => {
  log.info('NZ Parliament Bill Scraper starting…')
  await ensureDir(DOWNLOAD_DIR)
  await ensureDir(path.dirname(CSV_PATH))
  await ensureDir(FULLTEXT_DIR)

  const browser = await launchBrowser()
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 1600 })
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  )
  page.setDefaultTimeout(60000)

  // Second tab for details/legislation so the list page stays put
  const detailPage = await browser.newPage()
  await detailPage.setViewport({ width: 1280, height: 1600 })
  await detailPage.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  )
  detailPage.setDefaultTimeout(60000)

  const results = []
  let scrapedCount = 0

  try {
    log.info('Navigating to bills list (Current tab)…')
    await gotoWithRetry(page, BILL_SITE_INVOICES_URL, { mode: 'list' })

    const seen = new Set()

    let pageIndex = 1
    let prevFirstHref = '' // <-- define before the loop

    outer: while (true) {
      const listUrl = page.url() // <-- define listUrl for logging
      log.info(`\n--- Page ${pageIndex} (${listUrl}) ---`)

      // Marker for this page's first bill href
      const firstHref = await page.evaluate(() => {
        const a = Array.from(document.querySelectorAll('a[href]'))
          .map((a) => a.getAttribute('href') || a.href || '')
          .find((h) => /\/v\/\d+\/[a-z0-9-]+/i.test(h))
        return a || ''
      })

      // If the marker didn’t change since last loop, assume end of pagination
      if (firstHref && firstHref === prevFirstHref) {
        log.warn(
          'List content marker did not change; possible end of pagination. Stopping.'
        )
        break
      }

      // Record the current marker so the next loop can compare
      prevFirstHref = firstHref

      // Optional: expand lazy lists on the current page
      // await autoLoadAll(page)

      let pageLinks = await collectBillLinks(page)
      pageLinks = pageLinks.filter((u) => !seen.has(u))
      log.info(`Found ${pageLinks.length} new bill links on page ${pageIndex}.`)

      if (!pageLinks.length) {
        const snap = await page.evaluate(() =>
          (document.body.innerText || '').slice(0, 600)
        )
        log.warn('No bill links found on this page. Snapshot:\n', snap)
      }

      for (const billUrl of pageLinks) {
        if (MAX_BILLS && scrapedCount >= MAX_BILLS) break outer
        seen.add(billUrl)

        try {
          log.info(
            `Scraping [${scrapedCount + 1}${
              MAX_BILLS ? '/' + MAX_BILLS : ''
            }] ${billUrl}`
          )
          const base = await scrapeBillDetail(detailPage, billUrl)

          let viewWholeUrl = ''
          let fullText = ''
          if (base.readBillUrl) {
            const vw = await openViewWholeAndGetText(
              detailPage,
              base.readBillUrl
            )
            viewWholeUrl = vw.viewWholeUrl
            fullText = vw.fullText
          }

          let fullTextPath = ''
          if (fullText && fullText.length > 0) {
            const name = sanitizeFilename(
              base.billNo || base.title || `bill_${scrapedCount + 1}`
            )
            const filePath = path.join(FULLTEXT_DIR, `${name}.txt`)
            await writeText(filePath, fullText)
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
            status: base.status || '',
            error: '',
          })

          scrapedCount++
          await sleep(200)
        } catch (err) {
          log.warn(`Failed ${billUrl}: ${err.message}`)
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

      // Page cap check (for testing pagination deterministically)
      if (MAX_PAGES && pageIndex >= MAX_PAGES) {
        log.info(`Reached MAX_PAGES=${MAX_PAGES}. Stopping pagination.`)
        break
      }

      // 1) Try URL-based next page first
      const nextUrl = await getNextPageUrl(page)
      if (nextUrl) {
        log.info(`Going to Next page: ${nextUrl}`)
        await gotoWithRetry(page, nextUrl, { mode: 'list' })
        await sleep(300)
        pageIndex++
        continue
      }

      // 2) Fallback: click the <button data-test-ref="btn-next-page">Next</button>
      log.info('No Next URL found. Trying button-based Next…')
      const didClick = await clickNextPage(page)
      if (!didClick) {
        log.info('No Next page found (or disabled). Pagination complete.')
        break
      }

      // Re-sync readiness in case the SPA updated inline (URL may not change)
      await sleep(300)

      await gotoWithRetry(page, page.url(), { mode: 'list' })
      pageIndex++
    }

    log.info(`Writing CSV to ${CSV_PATH}…`)
    await writeBillsCsv(CSV_PATH, results)
    log.info('CSV saved at:', CSV_PATH)
    log.info(`Success. Scraped ${scrapedCount} bills.`)
  } catch (err) {
    log.error('Fatal error:', err)
  } finally {
    await browser.close()
    log.info('Browser closed. Done.')
  }
})()
