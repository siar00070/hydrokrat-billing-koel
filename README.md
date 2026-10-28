# HV Billing KOEL — Hydrokrat Ventures

Windows desktop billing software for Hydrokrat Ventures: create Quotations, Proforma Invoices, and Tax Invoices, manage customers and products, and export/print documents in the company's letterhead theme.

## Database setup (Supabase)

This app uses its own Supabase project, separate from the KSB app.

1. Create a new Supabase project.
2. In its SQL Editor, run `db/schema.sql`, then `db/seed_koel_products.sql` (876 KOEL Varuna products from the KFD Varuna catalogue, with model / kW & RPM / flow & head / MOC specs; rates are 0).
3. Create the login user under Authentication → Users.
4. Put the project URL and anon key in `src/config.js`.

To regenerate the product seed from a newer catalogue: `pip install pymupdf`, then `python tools/build_koel_products.py "<catalogue>.pdf"`.

## Running in development

```
npm install
npm start
```

Data is stored locally in a SQLite database under the app's user data folder (not inside this project folder), so it persists across restarts and app updates.

## Building the Windows installer

```
npm run dist
```

This produces an NSIS installer under `dist/`. Before building, replace `assets/icon.ico` with a real icon (256x256 recommended) — a placeholder is not included.

## Features

- **Dashboard** — quick-create buttons for each document type, recent documents.
- **Documents** — Quotation / Proforma Invoice / Tax Invoice, numbered in one running series shared with the KSB app (`QT-HV-2026-001`, `PI-HV-2026-001`, `TI-HV-2026-001`; numbers come from the KSB project's counters, so log in with the same email and password as KSB), search/filter, duplicate-as-another-type, print, and Save as PDF.
- **Customers & Products** — reusable master lists, add/edit/delete, searchable, used when building a document.
- **Stock** — receive supplier purchase invoices (against a PO via "Receive Goods", or direct) with one serial number per unit; Tax Invoices and Delivery Challans pick serials from stock (printed as "Sl. No"), and deleting them returns the units. Needs `db/migration_stock.sql` run once in Supabase.
- **Settings** — company details, bank details, and default Terms & Conditions per document type (pre-filled with Hydrokrat Ventures' details).
- **GST logic** — automatically splits into CGST+SGST when the customer's state matches the company's state (Tamil Nadu), otherwise applies IGST.
