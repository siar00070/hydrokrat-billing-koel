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
- **Dealers & Products** — reusable master lists, add/edit/delete, searchable, used when building a document.
- **Stock** — receive supplier purchase invoices (against a PO via "Receive Goods", or direct) with one serial number per unit, or fill it from the supplier's invoice PDF ("Upload Invoice PDF" reads items, qty, rate and serial ranges); Tax Invoices and Delivery Challans pick serials from stock (printed as "Sl. No"), and deleting them returns the units. Items with no serial numbers (e.g. control panels) are stocked by quantity and reduced automatically when sold. Pumps billed but not received can be marked Missing (then Received, Replaced with a new serial, or Written Off), and quantity-only items can be marked Short. The stock list downloads as Excel or PDF. Needs `db/migration_stock.sql`, `db/migration_stock_qty.sql` and `db/migration_stock_missing.sql` run once, in that order, in Supabase.
- **Settings** — company details, bank details, and default Terms & Conditions per document type (pre-filled with Hydrokrat Ventures' details).
- **GST logic** — automatically splits into CGST+SGST when the customer's state matches the company's state (Tamil Nadu), otherwise applies IGST.

## Dealer stock page

`docs/index.html` is the read-only stock page for dealers (sections from the Varuna catalogue, an order list they can print). It is **one self-contained file** with the logos built in, so uploading just that file to a free host such as Netlify is enough. It reads item names and quantities through the `public_stock_list()` database function (`db/migration_dealer_stock.sql`), so it needs no login and shows no prices, serial numbers or invoices.

To change it, edit `dealer-page/index.src.html` (logos are in `dealer-page/img`) and run `node tools/build_dealer_page.js`, which rewrites `docs/index.html`.

### Pump photos and product sections

The Products page groups products into the same sections as the dealer page (Borewell, Openwell, Pressure Booster and so on) and shows a catalogue photo beside each pump series. The rules live in `src/js/pumpCatalog.js` and the dealer page (`dealer-page/index.src.html`): change one, change the other. To refresh the photos from the catalogue:

```
python tools/build_pump_photos.py "KFD Varuna Catalogue.pdf"
node tools/build_app_photos.js
node tools/build_dealer_page.js
```
