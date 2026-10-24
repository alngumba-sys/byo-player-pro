BYO Player Pro — Android TV / Google TV
=======================================

This is a complete Android TV app that wraps your BYO Player Pro HTML app
in a native WebView (bypasses browser CORS, loads M3U/Xtream/Emby directly).

WHAT TO DO
----------
1. Read "BYO-Player-Pro-Google-Play-Guide.docx" — the full step-by-step
   guide to building the signed bundle and submitting to Google Play.
2. Build in Android Studio on your Mac (File > Open > this folder).
3. Build > Generate Signed App Bundle > produces app/release/app-release.aab
4. Upload that .aab in the Google Play Console.

KEY FACTS
---------
Package name : com.wexlot.byoplayerpro
Version      : versionCode 1, versionName 1.0.0
App bundled  : app/src/main/assets/index.html  (your v95 app, 1.9 MB)
Store assets : play-assets/  (icon, feature graphic, 5 TV screenshots)
TV banner    : app/src/main/res/drawable/tv_banner.png

To update later: replace app/src/main/assets/index.html with a newer build,
bump versionCode in app/build.gradle, rebuild with the SAME keystore.
