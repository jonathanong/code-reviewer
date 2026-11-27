# fix(exports): seek invoice export pages from the cursor

The invoice export walks an account's invoices in pages of 500, and a continuation page re-read the
account's invoices from the start in a generic plan. Build `listInvoicePage` so that it adds the cursor
condition only when there is a cursor, so each continuation page seeks from the cursor in the
`(account_id, id)` index. Adds a test for both page shapes and `scripts/explain-continuation.mjs` to read
the plan. The export reads the same rows in the same order.
