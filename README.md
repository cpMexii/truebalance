# TrueBalance Budget Planner

A private dark-theme annual and monthly budget app inspired by the supplied budget workbook. It has no accounts, ads, subscriptions, or external services. Your information stays in the browser on the device where you enter it.

## Start the app

On Windows, double-click `start.bat`. If Python is installed, the app opens at `http://localhost:8080` and can work offline after the first visit. If Python is not installed, the launcher opens `index.html` directly; all core features still work.

You can also double-click `index.html` yourself.

## Included features

- Annual dashboard with income, expenses, planned budget, cash flow, savings, and debt summaries
- Monthly spending wheel on the Annual Dashboard with a month selector and category breakdown
- Rearrangeable Dashboard boxes with desktop drag-and-drop and mobile Up/Down controls
- Resizable Dashboard boxes with saved width and height controls
- Saved width and height resizing for boxes throughout every app tab
- Small, standard, large, and extra-large app font settings
- Separate monthly planners for January through December
- Custom income, expense, debt, and savings categories
- Expense transaction log with month/category filters and CSV export
- Editable category dropdown on every transaction for quick corrections
- Full editing for saved transactions, including month, date, category, description, and amount
- Bills and subscription tracker with a paid checkbox for every month
- ZIP purchase tracker with automatic installment schedules, paid/overdue status, remaining balances, and Calendar integration
- Paid ZIP installments automatically included in monthly, weekly, and annual spending totals
- Check or clear every bill and subscription at once for a selected month
- Automatic recurring-payment totals in monthly and annual expenses
- Payment calendar, notes, and monthly to-do lists
- Local automatic saving, JSON backup/import, printing, and responsive mobile layout
- Custom tab ordering that saves automatically, with sidebar drag-and-drop on desktop and Move Up/Move Down controls on iPhone
- Optional Supabase email accounts and encrypted-connection cloud sync across devices
- Supabase Realtime updates across open devices, 250ms cloud saves, reconnect catch-up, and overwrite protection
- Full-access household sharing with separate member logins and private invitation codes

## Important backup note

Browser storage can be erased if you clear site data. Open **Settings & data** and choose **Export backup** regularly. The exported JSON file can restore the complete planner on another device or browser.

## Turn on cloud sync

Follow `SUPABASE-SETUP.md` to create a free Supabase project, add the included database table, and paste its public project settings into `config.js`. Then open **Settings & data → Cloud sync** to create an account or sign in.

## Install like an app

When running at `http://localhost:8080` in Chrome or Edge, use the browser's **Install app** option. TrueBalance includes offline support and will open in its own window after installation.
