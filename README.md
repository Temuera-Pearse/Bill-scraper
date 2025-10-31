to run test

export BILL_SITE_INVOICES_URL="https://bills.parliament.nz/bills-proposed-laws?lang=en&Tab=All"
export HEADLESS=false
export MAX_BILLS=0
export MAX_PAGES=2
node src/index.js
