const { createObjectCsvWriter } = require('csv-writer')

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

module.exports = { writeBillsCsv }
