# BYO Player Pro (Samsung Tizen): build v3.34.7 and upload to the beta

This folder is the Samsung TV app at version 3.34.7. It is built from the same
source as the Android/TCL app, so it carries the same recent changes:

- New Home: Featured today (poster on the left) with What's on now beside it,
  Top picks for you, and Trending now Top 10
- "Who's watching?" shows library loading progress, keeps profiles locked until
  the library is in, then puts the remote on the first profile
- Search: new tabs (All, Channels, Movies, Series, TV Guide, Sports) that the
  remote can walk with Left/Right; the Live tab is gone
- Settings: grouped menu, and redesigned Categories, Subtitles, Data & storage
  and About pages
- Choose genre / Choose channel fixed (genres show again, header no longer
  hidden under the top bar)
- Series episode pictures fall back to the series artwork
- Series play on to the next episode with a countdown
- Live channels that don't start now show "Stream unavailable" with Try again,
  Next channel and Back after 45 seconds, instead of loading forever
- Exit message no longer mentions Samsung Smart Hub, so it fits every TV
- Free trial is now 8 days (was 3)
- Search tabs now list every result in a grid (Show more loads the rest),
  the All tab has a See all card, and look-alike words no longer flood results
- Movies and Series grids keep loading more titles as you scroll (no 120 limit)
- About page layout fixed; Home remote moves go straight up/down and the top row
  comes fully back into view
- New: Get remote help (Settings > Connection). The TV shows a 4-digit code;
  BYO support enters it in the support console to set up connections and
  settings, send a message, add trial days or switch sections on/off
- When paused, the player shows the series, season and episode with the
  programme synopsis (movies show their synopsis too)

Android-only parts (the in-app updater, the native ExoPlayer player, its memory
fixes) are skipped automatically on Samsung. Samsung updates arrive through
the Samsung store.

    ByoPlayer/
    ├── index.html   <- the whole app, version 3.34.7 (one self-contained file)
    ├── config.xml   <- Tizen manifest, version 3.34.7
    ├── icon.png     <- app icon
    └── hls.min.js   <- HLS helper (loaded by index.html)

Nothing here is signed. Signing needs your Samsung certificate profile
(BYOCertificate), which only exists on your machine, so the final .wgt is
built in Tizen Studio.

---

## Step 1: Put the new files into your project

You are using the NEW app/package (BYOPlayr22) created with BYOCertificate.
Its config.xml has the new package and application id, so do NOT overwrite it.

1. In Tizen Studio, open your BYOPlayr22 project.
2. Replace `index.html` and `hls.min.js` with the ones from this folder
   (drag in, overwrite).
3. Open the project's own `config.xml` and change only the version on the
   `<widget ...>` line to `version="3.34.7"`. Leave the package and
   application id as they are. Save.
4. Keep the project's `icon.png`.

(The `config.xml` in this folder is a reference copy; its ids belong to the
old app, which is why you keep your project's own file.)

---

## Step 2: Build the signed .wgt

1. Tools -> Certificate Manager: make sure **BYOCertificate** is the active
   profile (tick).
2. Right-click the project -> **Build Signed Package**.
3. The new `.wgt` appears in the project's output folder (usually `Debug`).
   That is the file you upload.

---

## Step 3: Upload to the beta

1. Sign in to Samsung Apps TV Seller Office: https://seller.samsungapps.com
2. Open the new BYO Player app (package BYOPlayr22).
3. Add a new version / binary and upload the `.wgt` (3.34.7).
4. Keep the beta test running (or start a new round if asked) and submit.

---

## Test on your Samsung TV first (optional)

1. On the TV: Apps -> press 1 2 3 4 5 -> Developer mode on, enter your PC's IP.
2. Tizen Studio -> Device Manager -> add the TV.
3. Right-click the project -> Run As -> Tizen Web Application.
4. Check: Who's watching? loading box, Home, Search tabs, Settings pages,
   Movies -> Choose genre, a series episode ending, a live channel.
