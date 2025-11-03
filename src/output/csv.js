const { createObjectCsvWriter } = require('csv-writer')
const fs = require('fs')
const path = require('path')

async function writeBillsCsv(csvPath, records) {
  const csvWriter = createObjectCsvWriter({
    path: csvPath,
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
  await csvWriter.writeRecords(records)
}

async function writeBillsJson(jsonPath, records) {
  const structured = records.map((r) => ({
    billNumber: r.billNo,
    title: r.title,
    parliamentNumber: r.parliament,
    memberInCharge: r.mpInCharge,
    committee: r.committee,
    billUrls: {
      parliament: r.billUrl,
      legislationVersions: r.readBillUrl,
      whole: r.viewWholeUrl,
    },
    filePath: r.fullTextPath,
    summarySnippet: r.summarySnippet,
  }))

  fs.writeFileSync(jsonPath, JSON.stringify(structured, null, 2))
  console.log(`✅ Written ${structured.length} bills to ${jsonPath}`)
}

module.exports = { writeBillsCsv, writeBillsJson }
