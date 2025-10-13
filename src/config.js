require('dotenv').config()
const path = require('path')

const {
  BILL_SITE_INVOICES_URL = 'https://bills.parliament.nz/bills-proposed-laws?Tab=All',
  DOWNLOAD_DIR = './Bill-tracker/pdfs',
  HEADLESS = 'true',
  MAX_BILLS,
  PUPPETEER_EXECUTABLE_PATH,
} = process.env

const MAX_PAGES = Number(process.env.MAX_PAGES || 0) // 0 = no page cap

const ROOT_DIR = process.cwd()

module.exports = {
  BILL_SITE_INVOICES_URL,
  MAX_PAGES,
  DOWNLOAD_DIR: path.resolve(ROOT_DIR, DOWNLOAD_DIR),
  CSV_PATH: path.resolve(ROOT_DIR, './Bill-tracker/bills.csv'),
  FULLTEXT_DIR: path.resolve(ROOT_DIR, './Bill-tracker/fulltext'),
  ROOT_DIR,
  HEADLESS,
  MAX_BILLS: Number(MAX_BILLS || 0), // 0 = no cap
  PUPPETEER_EXECUTABLE_PATH,
}
