const { gotoWithRetry } = require('../browser/goto')

async function scrapeBillDetail(page, billUrl) {
  await gotoWithRetry(page, billUrl, { mode: 'detail' })

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

module.exports = { scrapeBillDetail }
