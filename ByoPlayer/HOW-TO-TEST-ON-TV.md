# Testing BYO Player Pro on a Samsung Tizen TV

This folder is a complete, ready-to-load Tizen web application:

    ByoPlayer/
    ├── index.html   ← the whole app (single self-contained file)
    ├── config.xml   ← Tizen manifest (privileges, screen size, app id)
    └── icon.png     ← 512×512 app icon

You sideload it onto your own TV for testing. No Samsung Store review is
needed for personal testing — that only applies to public publishing.

---

## What you need

- A **Samsung Developer account** (free): https://developer.samsung.com
- **Tizen Studio** on your computer (Windows / macOS / Linux)
- A **Samsung Tizen TV**, 2017 model or newer (Tizen 3.0+)
- **TV and computer on the same Wi-Fi / LAN**
- Your real **M3U URL** or **Xtream Codes** login to test playback

---

## Step 1 — Install Tizen Studio (one-time)

1. Go to https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html
2. Download **Tizen Studio (with IDE installer)** for your OS and run it.
   - It needs **Java (JDK 8+)** — the installer usually flags this if missing.
3. Open Tizen Studio → **Tools → Package Manager**.
4. In Package Manager, open the **Extension SDK** tab and install
   **Samsung Certificate Extension** and **TV Extensions** (pick the latest
   TV version). Let it finish.

---

## Step 2 — Create a certificate (one-time)

Tizen refuses to install an unsigned app, so make a free author certificate:

1. Tizen Studio → **Tools → Certificate Manager → +** (create).
2. Choose **Samsung** certificate type (needed for real TVs; "Tizen" type is
   for the emulator only).
3. Sign in with your Samsung account, follow the wizard to create an
   **Author certificate** and a **Distributor certificate**. When asked for
   a DUID, you'll add the TV in Step 4 first if needed, then come back —
   Certificate Manager can pull the TV's DUID once the TV is connected.
4. Set this certificate profile as **Active**.

---

## Step 3 — Turn on Developer Mode on the TV (one-time)

1. On the TV, open **Apps**.
2. Using the remote, type **1 2 3 4 5** on the keypad. A Developer Mode
   panel appears.
3. Toggle **Developer mode ON**.
4. In **Host PC IP**, enter **your computer's IP address**
   (e.g. 192.168.1.20 — find it in your computer's network settings).
5. Press OK and **restart the TV**.

---

## Step 4 — Connect the TV to Tizen Studio

1. Find your **TV's IP address**: TV **Settings → General → Network →
   Network Status → IP Settings** (or Settings → Support → About).
2. In Tizen Studio open **Tools → Device Manager**.
3. Click **Remote Device Manager (the + / scan icon) → Add**, enter the
   **TV's IP** (port stays 26101), and toggle it **ON** to connect.
4. The first connect shows a prompt **on the TV** — accept it. The TV should
   now appear as a connected device.

---

## Step 5 — Import this folder as a project

1. Tizen Studio → **File → Import → Tizen → Tizen Project**.
2. Select **this `ByoPlayer` folder**. It imports as a TV Web app (it already
   has `config.xml`, `index.html`, `icon.png`).
   - Alternatively: **File → New → Tizen Project → Template → TV → Web
     Application → Empty**, then copy these three files in, replacing the
     generated ones.

---

## Step 6 — Build, install, run

1. Right-click the project → **Run As → Tizen Web Application**.
2. Tizen Studio packages a **`.wgt`**, signs it with your certificate,
   installs it on the TV, and launches it.
3. BYO Player Pro opens **full-screen on the TV**.

> If Run is greyed out, make sure the **certificate profile is Active**
> (Step 2) and the **TV shows as connected** in Device Manager (Step 4).

---

## Step 7 — Test with your real playlist

1. In the app, go to **Settings → Connection**.
2. Paste a real **M3U URL**, or enter your **Xtream Codes** server /
   username / password, and **Connect & Load**.
3. Real streams play here through the TV's native **AVPlay** engine — this is
   the first place live playback actually runs (the web preview can't reach
   external streams).

---

## What to verify on real hardware

These only prove out on an actual TV, so check them first:

- **Playback** — does your provider's HLS/TS actually play through AVPlay?
- **Remote / D-pad** — arrows move focus, OK selects, Back/Return exits,
  colour keys where used.
- **Multi-View** — how many simultaneous streams your TV model decodes
  (the app auto-detects and caps to 2 / 3 / 4).
- **EPG + live scores** — whatever your provider's guide/metadata supplies.
- **Catch-up / DVR** — depends on your provider's archive window.

---

## Making a `.wgt` you can share / reinstall

Right-click the project → **Build Signed Package**. The `.wgt` lands in the
project's output folder. You can reinstall it on any dev-mode TV from Tizen
Studio, or via the command line:

    tizen install -n BYO_Player_Pro.wgt -t <your-tv-name>

(`tizen` lives in Tizen Studio's `tools/ide/bin` folder.)

---

## Going to the Samsung TV App Store later (optional)

For public distribution (not needed for testing):

1. Register as a seller at the **Samsung Seller Office**
   (https://seller.samsungapps.com).
2. Replace the placeholder widget id in `config.xml`
   (`http://byoplayer.wexlot.com/byoplayerpro`) with your own domain-based id.
3. Upload the signed `.wgt`, add store metadata/screenshots, and submit for
   Samsung's review.

---

## Troubleshooting

- **"Certificate error" on install** → certificate profile isn't Active, or
  it's a "Tizen" cert instead of a **Samsung** cert (real TVs need Samsung).
- **TV won't connect** → both devices on the same network? Host PC IP set
  correctly on the TV (Step 3)? TV restarted after enabling dev mode?
- **App installs but streams don't play** → that's a provider/stream issue,
  not the app: check the M3U/Xtream URL works elsewhere, and that the stream
  format is one the TV's AVPlay supports (HLS .m3u8 and MPEG-TS are safest).
- **Black screen on launch** → confirm `content src="index.html"` in
  config.xml matches the actual filename.

---

Support: alngumba@gmail.com
