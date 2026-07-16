# TrueBalance Budget Planner

A private dark-theme annual and monthly budget app inspired by the supplied budget workbook. It has no accounts, ads, subscriptions, or external services. Your information stays in the browser on the device where you enter it.

## Start the app

On Windows, double-click `start.bat`. If Python is installed, the app opens at `http://localhost:8080` and can work offline after the first visit. If Python is not installed, the launcher opens `index.html` directly; all core features still work.

You can also double-click `index.html` yourself.

## Included features

- Annual dashboard with income, expenses, planned budget, cash flow, savings, and debt summaries
- Separate monthly planners for January through December
- Custom income, expense, debt, and savings categories
- Expense transaction log with month/category filters and CSV export
- Editable category dropdown on every transaction for quick corrections
- Bills and subscription tracker with a paid checkbox for every month
- Check or clear every bill and subscription at once for a selected month
- Automatic recurring-payment totals in monthly and annual expenses
- Payment calendar, notes, and monthly to-do lists
- Local automatic saving, JSON backup/import, printing, and responsive mobile layout
- Custom tab ordering that saves automatically, with sidebar drag-and-drop on desktop and Move Up/Move Down controls on iPhone
- Optional Supabase email accounts and encrypted-connection cloud sync across devices

## Important backup note

Browser storage can be erased if you clear site data. Open **Settings & data** and choose **Export backup** regularly. The exported JSON file can restore the complete planner on another device or browser.

## Turn on cloud sync

Follow `SUPABASE-SETUP.md` to create a free Supabase project, add the included database table, and paste its public project settings into `config.js`. Then open **Settings & data → Cloud sync** to create an account or sign in.

## Install like an app

When running at `http://localhost:8080` in Chrome or Edge, use the browser's **Install app** option. TrueBalance includes offline support and will open in its own window after installation.
