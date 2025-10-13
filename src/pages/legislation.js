const { gotoWithRetry } = require('../browser/goto')

async function openViewWholeAndGetText(page, legislationUrl) {
  if (!legislationUrl) return { viewWholeUrl: '', fullText: '' }

  await gotoWithRetry(page, legislationUrl, { mode: 'generic' })

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
    try {
      viewWholeUrl = new URL(viewWholeUrl, page.url()).toString()
    } catch {}
    await gotoWithRetry(page, viewWholeUrl, { mode: 'generic' })
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

module.exports = { openViewWholeAndGetText }
