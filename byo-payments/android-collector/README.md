# BYO Collector (Android)

The dedicated-phone app that reads **telebirr payment SMS** and forwards them to the
BYO Player Pro backend, which matches them to a subscription and unlocks the TV.

- Installs on **one dedicated phone** holding the telebirr collection SIM (sideload, **not** Play Store).
- Reads only SMS from the **telebirr** sender id (everything else is ignored).
- Parses `{amount, payer last-4, transaction id}` and POSTs to `/ingest-sms`.
- **Offline queue** (retries if internet drops) + a foreground service that keeps it alive and restarts on reboot.
- A simple screen to grant SMS permission, set the API key, test parsing, and watch recent events.

The backend is the referee — this app never decides anything about money. It just forwards verified telebirr receipts.

---

## Get the APK — GitHub Actions (no Android Studio needed)

1. Create a new GitHub repo (e.g. under `alngumba-sys`) and push this `android-collector` folder to it.
2. In the repo: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `COLLECTOR_API_KEY`
   - Value: the same key you set on the backend (`supabase secrets set COLLECTOR_API_KEY=…`).
3. Go to the **Actions** tab → **Build APK** → **Run workflow** (or just push — it runs automatically).
4. When it finishes, open the run → **Artifacts** → download **`byo-collector-apk`** → inside is **`app-debug.apk`**.

That APK is what you sideload onto the collector phone.

> The workflow generates the Gradle wrapper itself, so the repo stays text-only — no binary files needed.

---

## Or build locally in Android Studio

1. **Android Studio → Open** → select this `android-collector` folder. It regenerates the Gradle wrapper and syncs.
2. **Build → Build Bundle(s)/APK(s) → Build APK(s)**.
3. The APK is at `app/build/outputs/apk/debug/app-debug.apk`.

You can set the key at build time instead of a secret:
`./gradlew :app:assembleDebug -PCOLLECTOR_API_KEY=your-key`
…or leave it blank and type it into the app's **Collector API key** field after install.

---

## Install on the dedicated phone

1. Copy `app-debug.apk` to the phone (USB, email to yourself, or a cloud drive).
2. On the phone: **Settings → Apps → Special access → Install unknown apps** → allow your file manager/browser.
3. Open the APK → **Install**.
4. Launch **BYO Collector**:
   - Tap **Grant SMS permission** → allow.
   - If the key wasn't baked in, paste the **Collector API key** → **Save key**.
   - (Optional) paste a sample telebirr SMS into **Test a telebirr SMS** → **Test parse** to confirm it reads it.
5. Keep the phone **plugged in, online, and with the telebirr SIM**. The foreground notification shows it's watching.

## Configuration (baked defaults)

Set in `app/build.gradle.kts` (or override with `-P` flags):

| Property | Default |
|---|---|
| `INGEST_URL` | `https://lkftnbkuuitaxtlvrqfj.supabase.co/functions/v1/ingest-sms` |
| `SUPABASE_ANON` | your project's publishable key |
| `COLLECTOR_API_KEY` | `SET_ME_IN_SETTINGS` (set via secret, `-P`, or in-app) |

## Testing without real money

Use the in-app **Test parse** box with the sample SMS. To test the full path, send a real
**ETB 5** telebirr payment to the collection number — the TV should unlock within seconds.

## Notes

- **SMS permission + Play Store:** this app would be rejected from Play (SMS-reading apps are restricted). That's fine — it's sideloaded on your own phone and never distributed to customers. Only this one phone needs the permission; the TV app and customer never do.
- **"Phone went offline" alerting:** best done server-side (watch for a gap in ingested payments / a heartbeat). The app keeps itself resident and drains its retry queue; wiring a server-side alert is a small follow-up.
