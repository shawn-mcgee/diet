# Daily

A mobile-first, static diet and weight tracker. No runtime dependencies or server to host. Google sign-in connects a personal Google Sheet through Apps Script. When Google is configured, sign-in is required before viewing or editing the workspace. Without Google configuration, the app runs in clearly marked local mode.

## Run

Requires Node.js 22 or later. The app has no runtime dependencies; jsdom is used for development tests.

```sh
npm ci
npm run dev
npm test
npm run build
```

Open http://localhost:5173. The build is in `dist/`. All asset paths are relative, including for GitHub project Pages URLs.

## Use

- **Daily log:** enter a short description, calories, and protein; or search the library and enter an amount. Select the date to view or backfill meals. Edit/delete entries from the log.
- **Foods & recipes:** click an item name to edit. Add foods or build recipes from linked foods/recipes, set the batch yield, and log portions from the library.
- **Portion size:** every food and recipe has an editable text label, such as `1 breast`, `1 lb`, `3 tbsp`, `16oz`, or `1 portion`. The label describes the food's numeric reference amount (or one recipe portion). It is not parsed. For example, set a food's label to `1 breast`, reference amount to `170`, unit to `g`, and its calories/protein to the values for that 170 g breast. Calculations use numeric amounts, including g/oz conversion. Custom units such as `cup`, `egg`, and `ml` are also supported; there is no assumed volume-to-mass conversion.
- **Linked values:** food edits recalculate recipes, nested recipes, and past linked meal entries. Quick entries retain their entered numbers. The app blocks deleting items still referenced elsewhere and changing units while in use. Portion labels can always be edited. Existing backups without labels are migrated automatically.
- **Weight:** saves lbs and the actual entry timestamp. Older measurements can be inspected/deleted from Trends → View data table. Weight records always use the current timestamp, even if another food-log date is selected.
- **Trends:** 7/30/90-day and all-time charts plus accessible data tables. Missing food-log days appear as gaps and are excluded from averages. Goals show the current settings, not historical targets.
- **Settings:** goals, Google sign-in, Sheet reload, JSON export/import. Initial goals are editable placeholders, not individualized recommendations.

Starter nutrition values are approximate generic values with explicit preparation states. Check labels, brands, and preparation and adjust them before relying on them. Use [USDA FoodData Central](https://fdc.nal.usda.gov/) to look up values. Initial foods are per 100 g; labels can be changed with their associated numeric amount and nutrition.

## Google setup

This is a single-user application. Your public client ID goes in the static app; secrets and access rules stay in Apps Script. No Google client secret is needed.

1. Create a private Google Sheet for this app. Copy the spreadsheet ID from its URL.
2. In Google Cloud, configure an OAuth consent screen and a **Web application** OAuth client. Add yourself as a test user if the app is in testing. Add the exact origins to **Authorized JavaScript origins**:
   - `http://localhost:5173` for development.
   - `https://YOUR_USERNAME.github.io` for Pages (origin only, no repository path).
3. In your Sheet, open **Extensions → Apps Script**. Paste `apps-script/Code.gs` and `apps-script/Validation.gs` into separate script files. In Project Settings, enable the manifest file and replace it with `apps-script/appsscript.json` if needed.
4. Under **Project Settings → Script Properties**, set:

   | Property | Value |
   | --- | --- |
   | `CLIENT_ID` | Your Google web OAuth client ID |
   | `ALLOWED_EMAIL` | Your exact Google account email |
   | `SPREADSHEET_ID` | The private spreadsheet ID |

5. **Deploy → New deployment → Web app**. Execute as **Me**; access **Anyone**. Authorize the spreadsheet and external request permissions. The public endpoint verifies the Google token and the allowed email before reading or writing any data. Workspace administrators may restrict this deployment option.
6. Copy the deployment URL ending in `/exec` into `config.js` as `appsScriptUrl`; set `googleClientId` to the OAuth client ID. Do not use `/dev`.
7. Sign in using the button on the opening screen. A new Sheet is initialized from the starter library on the first successful sync. Local-mode records stay separate and are preserved. If local records exist, the opening screen provides an export button. To move them to the connected Sheet, export before signing in, then import the file from Settings after signing in. Import replaces the Sheet's app data.

On later backend changes, create a new version under **Deploy → Manage deployments → Edit** and retain the same deployment URL. After changing `src/core.js`, run `npm run sync:validation` and update `Validation.gs` too. The tests check that these files match.

The backend uses Google's [token verification endpoint and claim checks](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), with short-lived caching. This keeps the personal Apps Script deployment small; token verification depends on that endpoint's availability and quotas. Google recommends its authentication libraries for larger production services. Tokens are held in browser memory and never stored in localStorage. Requests use text/plain POST bodies to avoid a preflight, and follow the [Content Service redirect](https://developers.google.com/apps-script/guides/content). End-to-end authentication and cross-origin Sheet access must be checked on your deployed URL with your Google account.

### Sheet layout and sync

The `Diet` tab stores the complete application snapshot and two directly editable settings:

| Cell | Purpose |
| --- | --- |
| B2 | `calorieLimit`, kcal/day |
| B3 | `proteinGoal`, g/day |
| B4 onward | Encoded state chunks; edit foods, recipes, and logs through the app |

Do not rename the tab, move rows, or edit encoded chunks. The other tabs in your spreadsheet are untouched. Base64 is an encoding, not encryption; keep the Sheet private. One range write saves settings and the snapshot together. A content hash detects both other-device writes and direct Sheet goal edits; a script lock serializes writes. A conflicting device retains its local data and stops uploading. Export it, load the Sheet, then re-enter/import the desired changes. Import replaces the entire current state.

The browser caches data per Google user for recovery; local mode uses a separate cache. With Google configured, each page load opens a prominent sign-in screen and editing is blocked until authentication and Sheet loading succeed. Existing device data is preserved. Tokens stay in memory, so reloading requires signing in again. After sign-in, changes remain on the device if sync fails and retry after reconnection or via Retry sync. A persistent warning appears on every page while changes have not reached Sheets; only a successful save shows **Saved to Sheets**. Tokens expire; sign out/in if requested. Load Sheet to fetch edits from other devices. Clearing browser storage removes local-only or unsynced data. Export backups before clearing it. The app supports offline editing after signing in and loading, but is not an installable offline PWA.

## GitHub Pages

1. Create a GitHub repository, add these files, and push to `main`.
2. Under **Settings → Pages → Build and deployment**, select **GitHub Actions**.
3. The included `.github/workflows/pages.yml` runs tests, builds the static files, and deploys the artifact to GitHub Pages.
4. Visit `https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/`. Confirm this origin is allowed in the OAuth client. A custom domain needs its own authorized origin.

The workflow uses GitHub's Pages artifact deployment; a `gh-pages` branch is not required. To use branch deployment instead, publish the contents of `dist/` to the root of your `gh-pages` branch and select that branch in Pages settings.

## Verification limits

Tests cover recipe linking, nested recipes/cycles, portion labels and legacy migration, units, dates, imports, and the shared backend validator. DOM integration tests cover food/recipe editing, linked logging, weights and charts. Backend tests use a simulated Apps Script/Sheets environment; live OAuth and Sheet access require your Google configuration. The app deliberately contains no analytics, nutrition API key, photos, recommendations, or social features.
