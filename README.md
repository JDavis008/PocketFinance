# PocketFinance

A private, self-hosted personal finance app (in the vein of Rocket Money, Monarch, Copilot and YNAB). It runs on your own PC; your data stays in `data\` and never goes to anyone else's server.

## Getting started
1. Install [Node.js 24](https://nodejs.org) or newer (it uses the built-in `node:sqlite`).
2. In this folder: `npm install`, then `npm start`.
3. Open **http://127.0.0.1:48140**. The first visit asks you to create the owner password, then you start with an empty app: add accounts (Accounts → Add), import a bank file, or press **Settings → Load demo data** to look around first (one button removes it again).
4. Optional, Windows: run `install-autostart.ps1` so it starts hidden at sign-in and restarts after a crash (`stop.ps1` stops it).

Nothing personal ships in this repository: `data\` (database, encryption key, logs, receipts), `dist\`, `node_modules\` and `mobile/www/server-default.js` are git-ignored, so every copy starts fresh with its own password, family members, kids and settings.

## Features
- **Accounts & net worth**: banks, cards, loans, investments (with holdings), crypto, and manual assets like a home or car. Daily balance history and net-worth chart.
- **Transactions**: auto-cleaned merchant names, auto-categorized, search/filter, edit, split, notes, tax-deductible flag, exclude transfers, rules ("apply to all"), CSV export.
- **Recurring**: detects subscriptions, bills and paychecks (weekly to yearly), price-increase alerts, a calendar of upcoming charges, cancel links and instructions for about 50 services, a cancellation-letter writer, an alert if something charges after you cancelled, and an `.ics` calendar feed.
- **Budgets**: monthly per category with rollover, pace marker and "suggest budgets" from your last 3 months.
- **Spending insights**: category donut, month-over-month change, top merchants, pace vs last month, 12-month cash flow, savings rate.
- **Safe to spend & forecast**: projected cash for the next 30 days from your bills, income and usual spending.
- **Savings goals**: manual contributions or tied to an account balance.
- **Lower my bills**: finds negotiable bills, writes a call script, and tracks what you saved.
- **Credit score**: log scores from any free source, utilization from your cards, tips.
- **AI Advisor (Google Gemini)**: chat with a money coach that sees a summary of your real numbers (never account numbers or logins), plus daily insights on the dashboard. Needs a free API key from aistudio.google.com/apikey (Settings → AI Advisor). AI output is general education, not licensed financial advice.
- **Review inbox**: new transactions from the last 30 days wait in Review until you check the category and tick them off (Copilot-style).
- **Tags & receipts**: tag any transaction (vacation, work trip…) and filter or report by tag; attach photos or PDFs of receipts (stored in `data\receipts`, checked by file contents, 10 MB max).
- **Reports**: any date range, by account or tag; cash-flow diagram (income → spending groups/categories → saved), breakdowns by category, group, merchant, account or tag with CSV export, and a "Year in review".
- **Budgets — left to assign**: income minus budgets, YNAB-style "give every dollar a job".
- **Debt payoff planner**: avalanche vs snowball vs minimums, extra-payment slider, debt-free date, interest saved; uses the APR/minimum from your bank when available, editable.
- **Retirement planner**: FI number, FI age, monthly saving needed, Coast FI, and the chance your money lasts (1,000 simulated markets), prefilled from your own numbers.
- **Bank logins**: one-tap buttons on the dashboard that open your bank's own sign-in page (none until you add one). Add them from Accounts → Add → pick a bank → "Add login to dashboard". PocketFinance never sees bank passwords.
- **Investments** (Empower-style): holdings across accounts, asset mix (target-date funds split by year), fee analyzer with built-in expense ratios for ~90 popular funds/ETFs and the 30-year cost of fees, gains on cost, dividends.
- **Watchlists** (Simplifi-style): follow spending at a store, in a category or under a tag, with a monthly limit and alerts.
- **Money leaks** (Rocket Money/Trim-style): bank fees, card interest, foreign transaction fees, possible double charges, newly started subscriptions and unusual spending, with what each costs per year and what to do.
- **Taxes** (Reports → Taxes): deductions by category, missing receipts, often-deductible spending to review, income, CSV for your accountant.
- **Monthly recap**: an alert (and phone push) on the 1st with last month's spending, income, savings and biggest category.
- **Auto-tag rules**: rules can add tags as well as categories.
- **Household**: give a partner or family member their own password with full or view-only access (Settings → Household). Bank keys, passwords and network settings stay owner-only. The owner is the admin and sees a 🛡️ Admin badge in the top bar (members see their name and access level instead).
- **Home values**: track a home from its address and purchase price (Accounts → Add → Track a home's value, or Net worth → Homes). Without a key, the value follows the FHFA House Price Index for the home's 3-digit ZIP area (official, quarterly). With a free RentCast key (Settings → Home values), it uses an address-level market estimate with a value range, refreshed weekly. Link the mortgage to see equity. US homes only; Canadian homes can use "I'll enter the value myself".
- **Cancel subscriptions** (Rocket Money-style): a Cancel button on every subscription walks you through the fastest route — it spots charges billed through Apple, Google Play, PayPal, Amazon or Roku and sends you there — with the service's cancel page, a ready-to-send cancellation email, and a phone script. Record the confirmation number and PocketFinance tracks it: confirmed automatically once the next billing date passes with no charge, or an alert with a refund request and dispute steps if they bill you anyway. "Review your subscriptions" goes through each one (keep or cancel), and the Recurring page shows what cancelling has saved you.
- **Share**: the 📤 button shares the page you're on (a summary you can edit plus a picture of its chart) through the phone's share sheet, or the browser's. Settings → Android app → "Share PocketFinance" sends someone the download link.
- **Split & IOUs** (Splitwise-style): open any transaction → **👥 Share cost** to split it (half, a third, a quarter or any amount) with a roommate, partner or friend, or add an IOU by hand. The Split & IOUs page shows who owes you and who you owe per person, a 📤 **Remind** button that sends them the running total, and **Settle up**. Open IOUs show on the dashboard.
- **Quick search**: 🔍 in the top bar, **Ctrl+K** or **/** searches pages, accounts, categories and transactions (merchant, note or amount); arrow keys + Enter to open.
- **Restore from backup**: Settings → Your data → *Restore from backup…* loads a *Full backup (JSON)* (owner only). A copy of the current database is saved to `data\backups` first. Receipt files and bank logins aren't in the JSON, so receipts reattach only on the same PC and banks on another PC need connecting again.
- **Family**: a Family page for kids' money — weekly allowance paid automatically into Spend / Save / Give jars, chores (daily, weekly or one-off) that pay when ticked, a savings goal per kid, and a monthly family money check-in with talking points and notes.
- **3D buttons**: buttons have a raised face and press down when tapped, in light and dark mode.
- **Stay signed in**: sessions last 90 days and renew themselves while you use PocketFinance. In the phone app, signing in once remembers the phone (a device key kept by the app), so it signs itself in again, even when it reaches your PC by another address (home Wi-Fi vs Tailscale). Settings → Security lists those phones; remove one, sign out on it, or change your password to make it ask again.
- **Forgot password & email sign-in**: put an email on your account (and on household members) and set up an email account to send from (Settings → Email: Gmail, Outlook, iCloud or Yahoo with an app password, or any SMTP server). The sign-in page then offers **Forgot password?** and **Email me a sign-in code** (6-digit code, 15 minutes, 5 tries). No email set up? On the PC: `npm run reset-password`.
- **Automatic backups**: a full backup every day in `data\backups` (newest 14 kept); Settings → Your data lists them with Download and one-tap Restore, plus Back up now.
- **Phone app extras**: lock PocketFinance with fingerprint, face or the phone's PIN (Settings → This phone; asks on open and after a minute away), Back goes to the previous page, and "Use a different server…" switches servers.
- **Alerts**: low balance, large charge, bill due, over budget, new subscription, price increase, watchlist limits, fees and double charges, monthly recap, and connection problems. Shown in the app and optionally pushed to your phone through the free ntfy app.

## Integrations
| Source | What it covers | Setup |
|---|---|---|
| Plaid | 12,000+ US/CA banks, cards, loans, brokerages; balances, transactions, due dates/APR, holdings | Free keys at dashboard.plaid.com → Settings → Integrations. Use Sandbox for testing (`user_good` / `pass_good`), Production for real banks. |
| Teller | Direct connections to big US banks and card issuers (Chase, BofA, Wells Fargo, Citi, Capital One, Amex…). Free for up to 100 real connections (development env) | Free account at teller.io → Settings → Teller: Application ID, plus `certificate.pem` + `private_key.pem` for real banks (Sandbox needs none) |
| SimpleFIN Bridge | Many US banks, about $1.50/mo, you control it | Accounts → Add → SimpleFIN, paste a setup token |
| Files | Any bank CSV, OFX/QFX/QBO, and exports from Mint, Monarch, YNAB, Copilot, Rocket Money, Empower. Built-in formats for Chase, Bank of America, Wells Fargo, Citi, Capital One, Amex, Discover, US Bank, BMO (US and Canada, bank + Mastercard), RBC, TD, CIBC, Scotiabank | Accounts → Add → pick your bank → follow its download steps |
| Crypto | Watch-only BTC/ETH/SOL/LTC/DOGE addresses, manual amounts for others, CoinGecko prices | Accounts → Add → Crypto |
| FHFA HPI | Home values from the US House Price Index by 3-digit ZIP (free, no key; downloaded monthly, cached in `data\hpi-zip3.json`) | Automatic |
| RentCast | Address-level home value estimate + range (free plan: 50 lookups/month) | Free key at rentcast.io → Settings → Home values |
| ntfy | Phone push notifications | Settings → Alerts |
| Calendar | Bills as `.ics` (download or subscribe) | Recurring → Add to calendar |

**Popular banks**: Accounts → Add account shows a bank picker (BMO US, BMO Canada, Chase, BofA, Wells Fargo, Citi, Capital One, Amex, Discover, US Bank, PNC, Truist, Navy Federal, USAA, Ally, RBC and more, searchable). Each bank shows which automatic connections work for it (Plaid, Teller, SimpleFIN) and the exact steps to download a statement file from that bank.

## Running
- Auto-start hidden at sign-in with crash restart: `install-autostart.ps1`. Stop: `stop.ps1`.
- Logs: `data\server.log`. Database: `data\pocketpilot.db`. Encryption key for bank tokens: `data\secret.key`. Back up both together.
- Tests (each uses a throwaway database): `npm test` (end-to-end API), `node test/ai.js` (AI Advisor against a fake Gemini server), `node test/banks.js` (bank file formats + Teller against a fake Teller API), `node test/premium.js` (review, tags, receipts, reports, debt and retirement planners), `node test/more.js` (investments, watchlists, leaks, taxes, recap, auto-tags, household), `node test/homes.js` (home values against a fake FHFA file and fake RentCast), `node test/cancel.js` (cancelling subscriptions, share links, connect info), `node test/ious.js` (Split & IOUs, backup restore), `node test/family.js` (kids, allowance, chores, check-ins), `node test/backups.js` (automatic backups), `node test/login.js` (staying signed in, phone device keys, email codes, forgot password), `npm run test:install` (the Windows installer, after `npm run build:exe`).
- Phone access: by default only this PC can reach it. Settings → Security can open it to your home network, or put it behind `tailscale serve` for access from anywhere.

## Free server for anyone (Windows installer)
`npm run build:exe` makes `dist\PocketFinance-Server.exe` (about 94 MB), a free one-file installer for friends and family. Double-click it on any Windows 10/11 PC — no admin rights, no Node, no accounts:
- installs to `%LOCALAPPDATA%\PocketFinance` (app in `app\`, their data in `data\`), starts hidden at sign-in and restarts after a crash (`run-hidden.vbs` loop), adds a desktop + Start menu shortcut and an entry in Settings → Apps for uninstalling (which asks whether to keep the data);
- running it again updates in place and keeps the data; it also hands out the bundled Android app at Settings → Android app;
- Settings → **Connect your phone** shows the address (and a QR code) to type into the app, with an **Allow my Wi-Fi** button.
It is not code-signed, so Windows SmartScreen says "Windows protected your PC" — click **More info → Run anyway**. Don't run it on a PC that already runs PocketFinance from source with `install-autostart.ps1`: both use a Startup shortcut named *PocketFinance Server*.
Build: `npm run build:exe` (bundles with esbuild, embeds `public/`, the vendor files and the APK as Node single-executable assets, sets the icon with rcedit, injects with postject). Test: `npm run test:install` (installs into a temp folder with `--no-shortcuts`, checks serving, crash restart, update and uninstall).

## Android app
`mobile/` builds a small Android app (Capacitor) that opens a PocketFinance server, and it connects by itself:
1. the last server it reached, then
2. your own address if you made `mobile/www/server-default.js` (copy `server-default.example.js` and put in, say, your `tailscale serve` https address — the file is git-ignored), then
3. it searches your Wi-Fi for a PocketFinance server on port 48140 (turn on Settings → Connect your phone → **Allow my Wi-Fi** on the PC first).
If none answers, it shows a "Connect to your PocketFinance" screen where you type the address from Settings → Connect your phone (a bare IP like `192.168.1.20` becomes `http://192.168.1.20:48140`). Signed-in users can download the APK from Settings → Android app once it is in `dist\`.
Rebuild: `cd mobile && npm run sync:android`, then `cd android && gradlew assembleDebug` (JAVA_HOME pointing at a JDK 17+, e.g. Android Studio's `jbr`), then copy `app\build\outputs\apk\debug\app-debug.apk` to `dist\PocketFinance.apk`.

## iPhone and iPad
Two ways, both free:
- **Home-screen app (no install):** on the iPhone, open your PocketFinance address in **Safari** (for example your `tailscale serve` https address, or `http://<PC address>:48140` at home with *Allow my Wi-Fi* on), tap **Share → Add to Home Screen**. It opens full-screen with the PocketFinance icon, like an app.
- **Native app:** `mobile/ios` is the same launcher as the Android app (remembers your server, tries `server-default.js`, searches your Wi-Fi, iOS share sheet), built with Capacitor. You don't need a Mac: every push that touches `mobile/` runs the **iOS app** GitHub Action on a macOS runner, which compiles it and uploads an unsigned `PocketFinance.ipa` (Actions → latest run → Artifacts). Install that with [Sideloadly](https://sideloadly.io) or [AltStore](https://altstore.io), which sign it with your own Apple ID (free Apple IDs must re-sign every 7 days). With a Mac: `cd mobile && npm install && npm run sync:ios`, open `ios/App/App.xcworkspace` in Xcode, pick your team under Signing, and run it on your iPhone. The first Wi-Fi search asks for **Local Network** permission; allow it.
