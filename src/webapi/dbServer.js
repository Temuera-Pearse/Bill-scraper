// ./webapi/billsGateway.js
const fetch = require('node-fetch')

const API_BASE_URL = process.env.BILL_API_URL || 'http://localhost:4000/api'

async function sendBillsToServer(bills) {
  for (const bill of bills) {
    try {
      const res = await fetch(`${API_BASE_URL}/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bill),
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Failed (${res.status}): ${text}`)
      }

      const result = await res.json()
      console.log(
        `Sent ${bill.billNumber} successfully — ${result.reason || 'OK'}`
      )

      if (result.continue === false) {
        console.log('Backend signaled to stop scraping.')
        break
      }
    } catch (err) {
      console.error(`Error sending ${bill.billNumber}:`, err.message)
    }
  }
}

module.exports = { sendBillsToServer }
