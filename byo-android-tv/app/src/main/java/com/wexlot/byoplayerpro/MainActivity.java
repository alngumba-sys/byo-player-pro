package com.wexlot.byoplayerpro;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.annotation.OptIn;
import androidx.media3.common.util.UnstableApi;

/**
 * BYO Player Pro - Android TV / Google TV wrapper.
 *
 * Hosts the self-contained HTML app (bundled in assets/index.html) inside a
 * full-screen WebView. The WebView is configured so that, like the Tizen TV
 * build, it bypasses browser CORS limits and can play remote IPTV streams and
 * load M3U / Xtream / Emby / Jellyfin sources directly.
 */
@OptIn(markerClass = UnstableApi.class)
public class MainActivity extends Activity {

    private WebView webView;
    private android.widget.FrameLayout root;
    private static final int REQ_PLAY = 4201;

    // --- Featured-hero inline preview (muted, looping) — a small native ExoPlayer drawn OVER the
    //     WebView at the hero's media rectangle, so Featured today actually plays video on the TV.
    private androidx.media3.exoplayer.ExoPlayer previewPlayer;
    // TextureView (not PlayerView/SurfaceView): a SurfaceView sits in a layer BEHIND the window and the
    // Chromium WebView paints over its hole, so the video played invisibly. A TextureView is drawn in
    // the normal view stack, so it reliably shows on top of the WebView.
    private android.view.TextureView previewView;
    private int previewVidW = 0, previewVidH = 0;
    private String previewUrl;
    // True once the CURRENT title has actually rendered a real frame. Visibility must stay gated on
    // this, not just set eagerly -- see doPreviewStart/doPreviewRect.
    private boolean previewHasFrame = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Keep the screen on while the app (a media player) is in the foreground.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Remember the last crash (any thread) so Settings > About can show it; then let Android handle it.
        installCrashLogger(this);
        root = new android.widget.FrameLayout(this);
        setContentView(root);
        // Relaunched by our own update (installer callback or package-replaced): reopen straight to Home.
        boolean afterUpdate = consumeUpdateFlag() || isUpdateSuccess(getIntent());
        buildWebView(afterUpdate);
        if (afterUpdate) announceUpdated();
        handleUpdateIntent(getIntent());
    }

    static final String ACTION_UPDATE_STATUS = "com.wexlot.byoplayerpro.UPDATE_STATUS";
    static final String PREF_RELAUNCH = "relaunch_after_update";
    private boolean consumeUpdateFlag() {
        try { android.content.SharedPreferences sp = getSharedPreferences("byo_diag", MODE_PRIVATE);
            long t = sp.getLong(PREF_RELAUNCH, 0); if (t == 0) return false;
            sp.edit().remove(PREF_RELAUNCH).commit();
            return System.currentTimeMillis() - t < 15 * 60 * 1000L;   // only a recent update counts
        } catch (Exception e) { return false; } }
    private static boolean isUpdateSuccess(Intent i) {
        if (i == null) return false;
        if (i.getBooleanExtra("byo_updated", false)) return true;
        return ACTION_UPDATE_STATUS.equals(i.getAction()) && i.getIntExtra(android.content.pm.PackageInstaller.EXTRA_STATUS, -999) == android.content.pm.PackageInstaller.STATUS_SUCCESS;
    }
    private void announceUpdated() {
        try { String v = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            android.widget.Toast.makeText(this, "BYO Player updated to " + v, android.widget.Toast.LENGTH_LONG).show(); } catch (Exception ignored) {}
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); handleUpdateIntent(intent); }
    // Result of our installer session: ask the user to confirm when Android needs it, or report failure.
    private void handleUpdateIntent(Intent i) {
        if (i == null || !ACTION_UPDATE_STATUS.equals(i.getAction())) return;
        int st = i.getIntExtra(android.content.pm.PackageInstaller.EXTRA_STATUS, -999);
        if (st == android.content.pm.PackageInstaller.STATUS_PENDING_USER_ACTION) {
            try { Intent confirm = (Intent) i.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm != null) { confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); startActivity(confirm); } } catch (Exception e) { reportUpdate("error", -2); }
        } else if (st == android.content.pm.PackageInstaller.STATUS_SUCCESS) {
            // nothing to do: the new version is already running
        } else if (st != -999) {
            try { getSharedPreferences("byo_diag", MODE_PRIVATE).edit().remove(PREF_RELAUNCH).commit(); } catch (Exception ignored) {}
            if (st != android.content.pm.PackageInstaller.STATUS_FAILURE_ABORTED) reportUpdate("error", st);
            else reportUpdate("cancelled", 0);
        }
        i.setAction(Intent.ACTION_MAIN);   // handled once
    }
    // Install through Android's PackageInstaller session. Unlike opening the APK, this lets Android
    // hand control straight back to the app when the install finishes (it reopens on Home), and on
    // Android 12+ later updates can install without a confirm screen.
    private void installViaSession(java.io.File apk) throws Exception {
        android.content.pm.PackageInstaller pi = getPackageManager().getPackageInstaller();
        android.content.pm.PackageInstaller.SessionParams sp = new android.content.pm.PackageInstaller.SessionParams(android.content.pm.PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        sp.setAppPackageName(getPackageName());
        if (android.os.Build.VERSION.SDK_INT >= 31) sp.setRequireUserAction(android.content.pm.PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        int id = pi.createSession(sp);
        android.content.pm.PackageInstaller.Session session = pi.openSession(id);
        try {
            java.io.OutputStream o = session.openWrite("base.apk", 0, apk.length());
            java.io.InputStream in = new java.io.FileInputStream(apk);
            byte[] b = new byte[65536]; int n; while ((n = in.read(b)) > 0) o.write(b, 0, n);
            session.fsync(o); in.close(); o.close();
            Intent st = new Intent(this, MainActivity.class).setAction(ACTION_UPDATE_STATUS);
            int fl = android.app.PendingIntent.FLAG_UPDATE_CURRENT | (android.os.Build.VERSION.SDK_INT >= 31 ? android.app.PendingIntent.FLAG_MUTABLE : 0);
            android.app.PendingIntent p = android.app.PendingIntent.getActivity(this, 4711, st, fl);
            getSharedPreferences("byo_diag", MODE_PRIVATE).edit().putLong(PREF_RELAUNCH, System.currentTimeMillis()).commit();
            session.commit(p.getIntentSender());
        } finally { session.close(); }
    }

    private boolean playingLive = false, timersPaused = false, rebuildPending = false, launchingPlayer = false;
    private String pendingResultJs = null;

    static void installCrashLogger(final android.content.Context ctx) {
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        if (prev instanceof CrashLog) return;
        Thread.setDefaultUncaughtExceptionHandler(new CrashLog(ctx.getApplicationContext(), prev));
    }
    static final class CrashLog implements Thread.UncaughtExceptionHandler {
        final android.content.Context app; final Thread.UncaughtExceptionHandler prev;
        CrashLog(android.content.Context a, Thread.UncaughtExceptionHandler p) { app = a; prev = p; }
        @Override public void uncaughtException(Thread t, Throwable e) {
            try {
                Throwable r = e; while (r.getCause() != null && r.getCause() != r) r = r.getCause();
                StackTraceElement[] st = r.getStackTrace(); String at = st.length > 0 ? (" at " + st[0].getClassName().replaceAll(".*\\.", "") + "." + st[0].getMethodName() + ":" + st[0].getLineNumber()) : "";
                noteIssue(app, "crash " + r.getClass().getSimpleName() + (r.getMessage() != null ? (": " + r.getMessage()) : "") + at);
            } catch (Throwable ignored) {}
            if (prev != null) prev.uncaughtException(t, e);
        }
    }
    static void noteIssue(android.content.Context c, String msg) {
        try {
            String when = new java.text.SimpleDateFormat("d MMM HH:mm", java.util.Locale.US).format(new java.util.Date());
            String m = msg.length() > 160 ? msg.substring(0, 160) : msg;
            c.getSharedPreferences("byo_diag", MODE_PRIVATE).edit().putString("last", when + " - " + m).commit();
        } catch (Throwable ignored) {}
    }

    // If Android kills the WebView's renderer (low memory while a movie plays), don't let it take the
    // whole app down: drop the dead WebView and build a fresh one that reopens on the same profile.
    private final java.util.ArrayList<Long> goneTimes = new java.util.ArrayList<>();
    private void showStuckScreen(boolean crashed) {
        try { doPreviewStop(); } catch (Exception ignored) {}
        if (webView != null) { try { root.removeView(webView); webView.destroy(); } catch (Exception ignored) {} webView = null; }
        String wv = "";
        try { if (android.os.Build.VERSION.SDK_INT >= 26) { android.content.pm.PackageInfo pi = WebView.getCurrentWebViewPackage(); if (pi != null) wv = pi.packageName + " " + pi.versionName; } } catch (Throwable ignored) {}
        String last = ""; try { last = getSharedPreferences("byo_diag", MODE_PRIVATE).getString("last", ""); } catch (Exception ignored) {}
        String crumbs = ""; try { crumbs = getSharedPreferences("byo_diag", MODE_PRIVATE).getString("crumbs", ""); } catch (Exception ignored) {}
        String ver = ""; try { ver = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception ignored) {}
        android.widget.LinearLayout box = new android.widget.LinearLayout(this);
        box.setOrientation(android.widget.LinearLayout.VERTICAL); box.setGravity(android.view.Gravity.CENTER);
        box.setBackgroundColor(0xFF0B1120); int pad = (int) (32 * getResources().getDisplayMetrics().density); box.setPadding(pad, pad, pad, pad);
        android.widget.TextView t = new android.widget.TextView(this);
        t.setTextColor(0xFFFFFFFF); t.setTextSize(22); t.setGravity(android.view.Gravity.CENTER);
        t.setText("BYO Player could not open its screen");
        android.widget.TextView d = new android.widget.TextView(this);
        d.setTextColor(0xFFB8C2CF); d.setTextSize(15); d.setGravity(android.view.Gravity.CENTER); d.setPadding(0, pad / 2, 0, pad / 2);
        d.setText((crashed ? "The TV's web engine crashed" : "Android closed the TV's web engine (low memory)") + " 3 times while loading.\n\n"
                + "Please send a photo of this screen to BYO support.\n\n"
                + "App " + ver + " \u00B7 " + (wv.isEmpty() ? "WebView unknown" : wv) + " \u00B7 Android " + android.os.Build.VERSION.RELEASE + " \u00B7 " + android.os.Build.MODEL
                + (last.isEmpty() ? "" : ("\nLast issue: " + last))
                + (crumbs.isEmpty() ? "" : ("\n\nLast steps:\n" + crumbs)));
        android.widget.Button b = new android.widget.Button(this);
        b.setText("Try again"); b.setFocusable(true);
        b.setOnClickListener(v -> { goneTimes.clear(); root.removeView(box); buildWebView(true); });
        box.addView(t); box.addView(d); box.addView(b);
        root.addView(box, new android.widget.FrameLayout.LayoutParams(-1, -1));
        b.requestFocus();
    }
    private void recoverWebView() {
        noteIssue(this, "screen reloaded after low memory");
        try { doPreviewStop(); } catch (Exception ignored) {}
        if (webView != null) {
            try { root.removeView(webView); webView.destroy(); } catch (Exception ignored) {}
            webView = null;
        }
        if (timersPaused) timersPaused = false;   // the global timer pause died with the old renderer's view
        if (hasWindowFocus() || !isPlayerOnTop()) buildWebView(true); else rebuildPending = true;
    }
    private boolean isPlayerOnTop() { return PlayerActivity.current() != null; }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void buildWebView(boolean resume) {
        webView = new WebView(this);
        // Host the WebView inside a FrameLayout so a native video PlayerView can be overlaid on the
        // Featured-hero rectangle (the inline preview). The WebView stays on top so the hero's text,
        // buttons and the rest of the UI draw normally; the preview is inserted BELOW it and shows
        // through the hero's transparent media area.
        // Appended (not inserted at 0) so the WebView is always ABOVE the Featured-preview video, which
        // lives at index 0. While the preview plays, the page opens a transparent "window" over the
        // hero (see previewHole) so the video shows through with the title and Play button drawn on top.
        root.addView(webView, new android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT));

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                 // localStorage used by the app
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // allow autoplay of streams
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        // The app is loaded from file:///android_asset. Let its XHR/fetch (hls.js manifests and
        // segments, M3U/Xtream/Emby APIs) reach any http(s) server without CORS headers — the
        // same open posture as the Samsung TV build. Without this, hls.js can't fetch streams
        // from servers that don't send Access-Control-Allow-Origin.
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        // Use the WebView's own pixel size as the layout viewport (= the real
        // screen width in CSS px). With wide-viewport/overview ON, the 1920px
        // body made the WebView report a ~1920px viewport and render the page
        // as a shrunken "overview" thumbnail; OFF lets the in-page scale-to-fit
        // script read the true screen size and fill it correctly.
        // TVs: lay the app out on the 1920x1080 TV canvas it was designed for and let the
        // WebView scale it to the screen (the page sets width=1920 on TVs). Phones and
        // tablets keep the real screen width so the responsive layout applies.
        boolean tvMode = false;
        try {
            android.app.UiModeManager um0 = (android.app.UiModeManager) getSystemService(UI_MODE_SERVICE);
            tvMode = (um0 != null && um0.getCurrentModeType() == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION)
                    || getPackageManager().hasSystemFeature("android.software.leanback");
        } catch (Exception ignored) {}
        final boolean tvMode0 = tvMode;
        // TVs: overview mode lays out the 1920x1080 canvas and scales to fit.
        // Phones: native viewport so the responsive portrait layout applies.
        s.setLoadWithOverviewMode(tvMode);
        s.setUseWideViewPort(tvMode);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Allow the bundled https-style app to pull http streams (mixed content),
        // same relaxed posture as the TV build.
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // Keep navigation inside the WebView.
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false; // load everything in-app
            }
            @Override
            public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                if (view != webView) return true;
                boolean crashed = false; int prio = -1;
                try { if (android.os.Build.VERSION.SDK_INT >= 26) { crashed = detail.didCrash(); prio = detail.rendererPriorityAtExit(); } } catch (Throwable ignored) {}
                noteIssue(MainActivity.this, (crashed ? "screen engine crashed" : "screen engine closed by Android (low memory)") + " p" + prio);
                try { getSharedPreferences("byo_marks", MODE_PRIVATE).edit().putString("engineGoneAt", String.valueOf(System.currentTimeMillis())).commit(); } catch (Exception ignored) {}
                // The same failure over and over (e.g. the page kills the engine while it loads) must not turn
                // into an endless restart: after 3 in 2 minutes, stop and say what happened.
                long now = System.currentTimeMillis(); goneTimes.add(now);
                while (!goneTimes.isEmpty() && now - goneTimes.get(0) > 120000) goneTimes.remove(0);
                if (goneTimes.size() >= 3) { showStuckScreen(crashed); return true; }
                recoverWebView();
                return true;   // handled: keep the app (and any playing movie) alive
            }
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (view == webView) view.evaluateJavascript(
                    "try{window.addEventListener('error',function(e){try{ByoAndroid.noteJsError(String(e.message||'error')+' @'+String(e.lineno||'')+':'+String(e.colno||''));}catch(_x){}});}catch(_e){}", null);
                // Inject android-app class as early as possible so the dev banner never shows
                if (!tvMode0 && view == webView) {
                    view.evaluateJavascript(
                        "document.documentElement.classList.add('android-app');" +
                        "document.documentElement.classList.remove('tv-native');", null);
                }
            }
            @Override
            public void onPageFinished(WebView view, String url) {
                // Ensure android-app class is set (belt-and-suspenders with onPageStarted)
                if (!tvMode0 && view == webView) {
                    view.evaluateJavascript(
                        "document.documentElement.classList.add('android-app');" +
                        "var dh=document.querySelector('.dev-head');if(dh)dh.style.display='none';" +
                        "var rh=document.querySelector('.remote-help');if(rh)rh.style.display='none';", null);
                }
                if (pendingResultJs != null && view == webView) {
                    final String js = pendingResultJs; pendingResultJs = null;
                    view.postDelayed(new Runnable() { public void run() { if (webView != null) webView.evaluateJavascript(js, null); } }, 4000);
                }
            }
        });
        // Needed for HTML5 video fullscreen / media events.
        webView.setWebChromeClient(new WebChromeClient());

        // Make the WebView itself focusable so the TV remote D-pad reaches the app.
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.requestFocus();

        // Bridge so the web app's own "Exit" button can close the Android app.
        webView.addJavascriptInterface(new Object() {
            // Same as fetchToFile, with request headers (JSON object). Used for MAG / Stalker portals,
            // which need a set-top-box User-Agent, a mac cookie and a bearer token.
            @JavascriptInterface
            public void fetchToFileH(final String id, final String url, final String headersJson) { doFetch(id, url, headersJson); }

            @JavascriptInterface
            public void fetchToFile(final String id, final String url) { doFetch(id, url, null, 0); }

            // Same as fetchToFile, but stops (detail "too-big:<bytes>") once the file passes maxBytes.
            @JavascriptInterface
            public void fetchToFileMax(final String id, final String url, final double maxBytes) { doFetch(id, url, null, (long) maxBytes); }

            private void doFetch(final String id, final String url, final String headersJson) { doFetch(id, url, headersJson, 0); }

            private void doFetch(final String id, final String url, final String headersJson, final long maxBytes) {
                new Thread(new Runnable() { public void run() {
                    String status = "err", detail = "", path = "";
                    java.net.HttpURLConnection c = null;
                    try {
                        java.net.URL u = new java.net.URL(url);
                        int hops = 0;
                        while (true) {
                            c = (java.net.HttpURLConnection) u.openConnection();
                            c.setInstanceFollowRedirects(false);
                            c.setConnectTimeout(20000); c.setReadTimeout(90000);
                            c.setRequestProperty("User-Agent", "VLC/3.0.20 LibVLC/3.0.20");
                            c.setRequestProperty("Accept", "*/*");
                            if (headersJson != null && headersJson.length() > 2) {
                                try { org.json.JSONObject hj = new org.json.JSONObject(headersJson); java.util.Iterator<String> it = hj.keys();
                                    while (it.hasNext()) { String k = it.next(); c.setRequestProperty(k, hj.optString(k, "")); } } catch (Exception ignored) {}
                            }
                            int code = c.getResponseCode();
                            if (code >= 300 && code < 400 && hops < 6) {
                                String loc = c.getHeaderField("Location");
                                c.disconnect(); c = null;
                                if (loc == null) { detail = "http-" + code; break; }
                                u = new java.net.URL(u, loc); hops++; continue;
                            }
                            if (code < 200 || code >= 300) { detail = "http-" + code; c.disconnect(); c = null; }
                            break;
                        }
                        if (c != null) {
                            java.io.File f = new java.io.File(getCacheDir(), "fetch_" + id.replaceAll("[^A-Za-z0-9]", "") + ".txt");
                            java.io.InputStream in = new java.io.BufferedInputStream(c.getInputStream());
                            java.io.OutputStream out = new java.io.FileOutputStream(f);
                            byte[] buf = new byte[65536]; int n; long total = 0; boolean tooBig = false;
                            while ((n = in.read(buf)) > 0) { out.write(buf, 0, n); total += n; if (maxBytes > 0 && total > maxBytes) { tooBig = true; break; } }
                            out.close(); in.close();
                            if (tooBig) { try { f.delete(); } catch (Exception ignored) {} throw new java.io.IOException("too-big:" + total); }
                            status = "ok"; path = "file://" + f.getAbsolutePath(); detail = "size:" + f.length();
                        }
                    } catch (java.net.SocketTimeoutException e) { detail = "timeout";
                    } catch (java.net.UnknownHostException e) { detail = "dns";
                    } catch (javax.net.ssl.SSLException e) { detail = "ssl";
                    } catch (java.net.ConnectException e) { detail = "refused";
                    } catch (java.net.MalformedURLException e) { detail = "bad-url";
                    } catch (java.io.IOException e) { String m = String.valueOf(e.getMessage()); detail = m.startsWith("too-big:") ? m : "neterr";
                    } catch (Exception e) { detail = "neterr";
                    } finally { if (c != null) try { c.disconnect(); } catch (Exception ignored) {} }
                    final String js = "window.__byoFetchCb&&window.__byoFetchCb(" + org.json.JSONObject.quote(id) + "," + org.json.JSONObject.quote(status) + ","
                            + org.json.JSONObject.quote(detail) + "," + org.json.JSONObject.quote(path) + ")";
                    runOnUiThread(new Runnable() { public void run() { if (webView != null) webView.evaluateJavascript(js, null); } });
                } }).start();
            }

            // How big a playlist file (MB) this device can safely read into the page. TVs and boxes have little memory.
            @JavascriptInterface
            public int m3uLimitMb() {
                try {
                    android.app.ActivityManager am = (android.app.ActivityManager) getSystemService(ACTIVITY_SERVICE);
                    android.app.ActivityManager.MemoryInfo mi = new android.app.ActivityManager.MemoryInfo(); am.getMemoryInfo(mi);
                    long gb = mi.totalMem / (1024L * 1024L * 1024L);
                    if (am.isLowRamDevice() || mi.totalMem < 2700L * 1024L * 1024L) return 8;
                    if (gb < 5) return 20;
                    return 40;
                } catch (Exception e) { return 8; }
            }

            // Rewrite a downloaded M3U so it fits the TV's memory: every live channel first, then movies, then
            // series episodes, until the new file reaches budgetBytes. Answers through __byoFetchCb like fetchToFile.
            @JavascriptInterface
            public void slimM3U(final String id, final String fileUrl, final double budgetBytes) {
                new Thread(new Runnable() { public void run() {
                    String status = "err", detail = "", path = "";
                    try {
                        String fp = fileUrl.startsWith("file://") ? fileUrl.substring(7) : fileUrl;
                        java.io.File src = new java.io.File(fp);
                        java.io.File dst = new java.io.File(getCacheDir(), "slim_" + id.replaceAll("[^A-Za-z0-9]", "") + ".txt");
                        java.util.regex.Pattern ser = java.util.regex.Pattern.compile("(/series/|[sS]\\d{1,2}\\s*[eE]\\d{1,3})");
                        java.util.regex.Pattern vod = java.util.regex.Pattern.compile("(/movie/|/movies/|/series/|/vod/|\\.(mp4|mkv|avi|m4v|mov|wmv|flv|webm|mpg|mpeg)(\\?|$))", java.util.regex.Pattern.CASE_INSENSITIVE);
                        java.io.Writer w = new java.io.BufferedWriter(new java.io.OutputStreamWriter(new java.io.FileOutputStream(dst), "UTF-8"), 65536);
                        long budget = (long) budgetBytes, written = 0; long[] kept = new long[3]; long dropped = 0;
                        w.write("#EXTM3U\n"); written += 8;
                        long cap = budget;
                        for (int pass = 0; pass < 3; pass++) {   // 0 = live, 1 = movies, 2 = series
                            if (pass == 1) cap = written + Math.max(0, budget - written) / 2;   // movies get half of what is left, series the rest
                            if (pass == 2) cap = budget;
                            java.io.BufferedReader r = new java.io.BufferedReader(new java.io.InputStreamReader(new java.io.FileInputStream(src), "UTF-8"), 65536);
                            StringBuilder pend = new StringBuilder(); boolean inEntry = false; String line; boolean full = false;
                            while ((line = r.readLine()) != null) {
                                String t = line.trim();
                                if (t.isEmpty()) continue;
                                if (t.startsWith("#EXTINF")) { pend.setLength(0); pend.append(line).append("\n"); inEntry = true; continue; }
                                if (t.startsWith("#")) { if (inEntry) pend.append(line).append("\n"); continue; }
                                if (!inEntry) continue;
                                boolean isVod = vod.matcher(t).find();
                                int kind = !isVod ? 0 : ((ser.matcher(t).find() || ser.matcher(pend).find()) ? 2 : 1);
                                if (kind == pass) {
                                    int len = pend.length() + t.length() + 1;
                                    if (pass > 0 && (full || written + len > cap)) { full = true; dropped++; }
                                    else { w.write(pend.toString()); w.write(t); w.write("\n"); written += len; kept[pass]++; }
                                }
                                pend.setLength(0); inEntry = false;
                            }
                            r.close();
                        }
                        w.close();
                        try { src.delete(); } catch (Exception ignored) {}
                        status = "ok"; path = "file://" + dst.getAbsolutePath();
                        detail = "size:" + dst.length() + ";kept:" + kept[0] + ";movies:" + kept[1] + ";series:" + kept[2] + ";dropped:" + dropped;
                    } catch (Throwable e) { detail = "slim:" + e.getClass().getSimpleName(); }
                    final String js = "window.__byoFetchCb&&window.__byoFetchCb(" + org.json.JSONObject.quote(id) + "," + org.json.JSONObject.quote(status) + ","
                            + org.json.JSONObject.quote(detail) + "," + org.json.JSONObject.quote(path) + ")";
                    runOnUiThread(new Runnable() { public void run() { if (webView != null) webView.evaluateJavascript(js, null); } });
                } }).start();
            }

            // Native JSON POST (used for Supabase RPC). Bypasses WebView CORS / file:// origin quirks.
            // Result comes back via window.__byoHttpCb(id, status, body); status 0 = network error.
            @JavascriptInterface
            public void httpPost(final String id, final String url, final String headersJson, final String body) {
                new Thread(new Runnable() { public void run() {
                    int code = 0; String resp = "";
                    java.net.HttpURLConnection c = null;
                    try {
                        c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                        c.setConnectTimeout(15000); c.setReadTimeout(20000);
                        c.setRequestMethod("POST"); c.setDoOutput(true);
                        c.setRequestProperty("Content-Type", "application/json");
                        c.setRequestProperty("Accept", "application/json");
                        if (headersJson != null && headersJson.length() > 2) {
                            try { org.json.JSONObject hj = new org.json.JSONObject(headersJson); java.util.Iterator<String> it = hj.keys();
                                while (it.hasNext()) { String k = it.next(); c.setRequestProperty(k, hj.optString(k, "")); } } catch (Exception ignored) {}
                        }
                        byte[] b = (body == null ? "{}" : body).getBytes("UTF-8");
                        java.io.OutputStream os = c.getOutputStream(); os.write(b); os.close();
                        code = c.getResponseCode();
                        java.io.InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                        if (in != null) {
                            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                            byte[] buf = new byte[8192]; int n;
                            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                            in.close(); resp = bo.toString("UTF-8");
                        }
                    } catch (Exception e) { code = 0; resp = e.getClass().getSimpleName() + ": " + String.valueOf(e.getMessage());
                    } finally { if (c != null) try { c.disconnect(); } catch (Exception ignored) {} }
                    final String js = "window.__byoHttpCb&&window.__byoHttpCb(" + org.json.JSONObject.quote(id) + "," + code + "," + org.json.JSONObject.quote(resp) + ")";
                    runOnUiThread(new Runnable() { public void run() { if (webView != null) webView.evaluateJavascript(js, null); } });
                } }).start();
            }

            @JavascriptInterface
            public void openUrl(final String url) {
                runOnUiThread(new Runnable() { public void run() {
                    try { if (url != null && url.startsWith("https://")) startActivity(new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url))); } catch (Exception ignored) {}
                } });
            }

            // Score alert for a followed match. Shown over the video when the player is open.
            @JavascriptInterface
            public boolean scoreAlert(final String msg, final String chName, final String url) {
                final PlayerActivity pa = PlayerActivity.current();
                if (pa == null) return false;
                pa.runOnUiThread(new Runnable() { public void run() { pa.showAlert(msg, chName, url); } });
                return true;
            }

            @JavascriptInterface
            public String deviceInfo() {
                try {
                    org.json.JSONObject o = new org.json.JSONObject();
                    android.content.pm.PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                    o.put("version", pi.versionName);
                    long vc; try { vc = (android.os.Build.VERSION.SDK_INT >= 28) ? pi.getLongVersionCode() : pi.versionCode; } catch (Exception e) { vc = pi.versionCode; }
                    o.put("versionCode", vc);
                    o.put("platform", "android");
                    o.put("canInstall", true);
                    android.app.UiModeManager um = (android.app.UiModeManager) getSystemService(UI_MODE_SERVICE);
                    boolean tv = (um != null && um.getCurrentModeType() == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION)
                            || getPackageManager().hasSystemFeature("android.software.leanback");
                    o.put("tv", tv);
                    android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
                    o.put("density", dm.density); o.put("w", dm.widthPixels); o.put("h", dm.heightPixels);
                    return o.toString();
                } catch (Exception e) { return "{}"; }
            }

            @JavascriptInterface
            public void noteJsError(final String msg) { noteIssue(MainActivity.this, "page error: " + msg); }

            // Loading trail and markers, written straight to storage (commit) so they survive a crash of
            // the web engine: the page uses them to see which connection was loading when it crashed.
            @JavascriptInterface
            public void crumb(final String msg) {
                try { android.content.SharedPreferences sp = getSharedPreferences("byo_diag", MODE_PRIVATE);
                    String when = new java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US).format(new java.util.Date());
                    String all = sp.getString("crumbs", ""); String line = when + " " + (msg.length() > 120 ? msg.substring(0, 120) : msg);
                    String[] parts = (all.isEmpty() ? new String[0] : all.split("\n")); StringBuilder b = new StringBuilder();
                    int from = Math.max(0, parts.length - 7); for (int i = from; i < parts.length; i++) b.append(parts[i]).append("\n");
                    b.append(line); sp.edit().putString("crumbs", b.toString()).commit(); } catch (Exception ignored) {}
            }
            @JavascriptInterface
            public void setMark(final String key, final String value) {
                try { getSharedPreferences("byo_marks", MODE_PRIVATE).edit().putString(key, value == null ? "" : value).commit(); } catch (Exception ignored) {}
            }
            @JavascriptInterface
            public String getMark(final String key) {
                try { return getSharedPreferences("byo_marks", MODE_PRIVATE).getString(key, ""); } catch (Exception e) { return ""; }
            }

            @JavascriptInterface
            public String lastIssue() {
                try { return getSharedPreferences("byo_diag", MODE_PRIVATE).getString("last", ""); } catch (Exception e) { return ""; }
            }

            @JavascriptInterface
            public String getClipboard() {
                try {
                    android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                    if (cm == null || !cm.hasPrimaryClip() || cm.getPrimaryClip() == null || cm.getPrimaryClip().getItemCount() == 0) return "";
                    CharSequence t = cm.getPrimaryClip().getItemAt(0).coerceToText(MainActivity.this);
                    return t == null ? "" : t.toString();
                } catch (Exception e) { return ""; }
            }

            @JavascriptInterface
            public void toast(final String msg) {
                runOnUiThread(new Runnable() { public void run() {
                    try { android.widget.Toast.makeText(getApplicationContext(), msg, android.widget.Toast.LENGTH_LONG).show(); } catch (Exception ignored) {}
                } });
            }

            @JavascriptInterface
            public void exit() { runOnUiThread(new Runnable() { public void run() { finish(); } }); }

            // ---- In-app update: download the new APK, then open Android's installer ----
            // Progress/result is reported back to the page via window.__byoUpdate(state, pct).
            @JavascriptInterface
            public void downloadAndInstall(final String url) {
                new Thread(new Runnable() { public void run() { doDownloadInstall(url); } }).start();
            }

            // ---- Featured-hero inline preview (muted, looping native video) ----
            // Coordinates are CSS pixels from the web layout; converted to device px here.
            @JavascriptInterface
            public void previewStart(final String url, final double xCss, final double yCss,
                                     final double wCss, final double hCss, final boolean muted) {
                runOnUiThread(new Runnable() { public void run() { doPreviewStart(url, xCss, yCss, wCss, hCss, muted); } });
            }
            @JavascriptInterface
            public void previewRect(final double xCss, final double yCss, final double wCss, final double hCss) {
                runOnUiThread(new Runnable() { public void run() { doPreviewRect(xCss, yCss, wCss, hCss); } });
            }
            @JavascriptInterface
            public void previewMute(final boolean muted) {
                runOnUiThread(new Runnable() { public void run() { if (previewPlayer != null) previewPlayer.setVolume(muted ? 0f : 1f); } });
            }
            @JavascriptInterface
            public void previewStop() {
                runOnUiThread(new Runnable() { public void run() { doPreviewStop(); } });
            }
            // The page's CSS layout width (e.g. 1920 on TV). Lets us convert CSS px -> device px.
            @JavascriptInterface
            public void previewViewport(final double wCss) {
                runOnUiThread(new Runnable() { public void run() { setCssViewportW(wCss); } });
            }
            // Corner radius of the hero, as a fraction of the viewport width.
            @JavascriptInterface
            public void previewShape(final double radiusFrac) {
                runOnUiThread(new Runnable() { public void run() {
                    previewRadiusFrac = radiusFrac;
                    if (previewView != null) previewView.invalidateOutline();
                } });
            }
            // The page is about to make itself transparent over the hero ("on") so the video below shows
            // through. colors = "r,g,b;r,g,b;..." -- the page background (top-to-bottom gradient stops),
            // painted natively behind the now-transparent WebView so everything else looks unchanged.
            @JavascriptInterface
            public void previewHole(final boolean on, final String colors) {
                runOnUiThread(new Runnable() { public void run() { doPreviewHole(on, colors); } });
            }

            // Movies/episodes: hand off to the native ExoPlayer screen (plays MKV/HEVC/AC3 directly).
            @JavascriptInterface
            public void playNative(final String url, final String title, final String sub, final double startMs) {
                runOnUiThread(new Runnable() { public void run() {
                    Intent i = new Intent(MainActivity.this, PlayerActivity.class);
                    i.putExtra(PlayerActivity.EXTRA_URL, url);
                    i.putExtra(PlayerActivity.EXTRA_TITLE, title);
                    i.putExtra(PlayerActivity.EXTRA_SUB, sub);
                    i.putExtra(PlayerActivity.EXTRA_START, (long) startMs);
                    playingLive = false;
                    launchingPlayer = true; startActivityForResult(i, REQ_PLAY);
                } });
            }

            // Universal entry: one JSON {url,title,sub,startMs,live,qualities[],channels[],chIndex}.
            @JavascriptInterface
            public void playNativeAll(final String json) {
                runOnUiThread(new Runnable() { public void run() {
                    try {
                        org.json.JSONObject o = new org.json.JSONObject(json);
                        Intent i = new Intent(MainActivity.this, PlayerActivity.class);
                        i.putExtra(PlayerActivity.EXTRA_URL, o.optString("url"));
                        i.putExtra(PlayerActivity.EXTRA_TITLE, o.optString("title"));
                        i.putExtra(PlayerActivity.EXTRA_SUB, o.optString("sub"));
                        i.putExtra(PlayerActivity.EXTRA_START, o.optLong("startMs", 0));
                        i.putExtra(PlayerActivity.EXTRA_LIVE, o.optBoolean("live", false));
                        playingLive = o.optBoolean("live", false);
                        if (o.has("qualities")) i.putExtra(PlayerActivity.EXTRA_QUALITIES, o.getJSONArray("qualities").toString());
                        if (o.has("origBitrate")) i.putExtra(PlayerActivity.EXTRA_ORIG_BITRATE, o.optLong("origBitrate", 0));
                        if (o.has("channels")) i.putExtra(PlayerActivity.EXTRA_CHANNELS, o.getJSONArray("channels").toString());
                        i.putExtra(PlayerActivity.EXTRA_CH_INDEX, o.optInt("chIndex", 0));
                        if (o.has("headers")) i.putExtra(PlayerActivity.EXTRA_HEADERS, o.getJSONObject("headers").toString());
                        if (o.has("drm")) i.putExtra(PlayerActivity.EXTRA_DRM, o.getJSONObject("drm").toString());
                        if (o.has("episodes")) i.putExtra(PlayerActivity.EXTRA_EPISODES, o.getJSONArray("episodes").toString());
                        if (o.has("meta")) i.putExtra(PlayerActivity.EXTRA_META, o.getJSONObject("meta").toString());
                        if (o.has("guard")) i.putExtra(PlayerActivity.EXTRA_GUARD, o.getJSONObject("guard").toString());
                        launchingPlayer = true; startActivityForResult(i, REQ_PLAY);
                    } catch (Exception e) {
                        webView.evaluateJavascript("window.__byoNativeResult&&window.__byoNativeResult('error',0,0,0)", null);
                    }
                } });
            }

            // Same, plus server-capped fallback levels (JSON [{label,url,bitrate}]) for smooth playback.
            @JavascriptInterface
            public void playNativeQ(final String url, final String title, final String sub, final double startMs, final String qualitiesJson) {
                runOnUiThread(new Runnable() { public void run() {
                    Intent i = new Intent(MainActivity.this, PlayerActivity.class);
                    i.putExtra(PlayerActivity.EXTRA_URL, url);
                    i.putExtra(PlayerActivity.EXTRA_TITLE, title);
                    i.putExtra(PlayerActivity.EXTRA_SUB, sub);
                    i.putExtra(PlayerActivity.EXTRA_START, (long) startMs);
                    i.putExtra(PlayerActivity.EXTRA_QUALITIES, qualitiesJson);
                    playingLive = false;
                    launchingPlayer = true; startActivityForResult(i, REQ_PLAY);
                } });
            }
        }, "ByoAndroid");

        // Load the bundled app.
        webView.loadUrl("file:///android_asset/index.html" + (resume ? "#resume" : ""));
        // Pre-build the Featured-preview player while the page is still loading.
        webView.postDelayed(new Runnable() { public void run() { ensurePreviewPlayer(); } }, 1500);
    }

    // CSS pixels (web layout) -> device pixels. The TV build lays the page out on a 1920-wide canvas
    // and the WebView scales it to the real screen, so the factor is realWidth / 1920 on TV; on a
    // phone/tablet the layout width equals the screen width, so the factor is the WebView's own width
    // over the CSS width it reports. We derive it from the actual WebView pixel width vs the page's
    // reported layout width, which the JS passes along implicitly by sending the hero rect in CSS px
    // and us scaling by (webView.getWidth() / cssViewportWidth). cssViewportWidth is cached from JS.
    private double cssViewportW = 0;
    private static final long PREVIEW_START_MS = 20L * 60L * 1000L;
    // Build the TextureView + ExoPlayer ahead of the first preview (called shortly after launch), so
    // the first Featured title doesn't also pay for player construction before it can buffer.
    private void ensurePreviewPlayer() {
        try {
            if (previewView == null) {
                previewView = new android.view.TextureView(MainActivity.this);
                previewView.setOpaque(false);
                previewView.setFocusable(false);
                // Added BELOW the WebView (index 0); the page makes the hero transparent once a frame
                // is up, so the video fills the whole banner with the title/Play drawn over it.
                // VISIBLE but at alpha 0 until the first real frame is decoded. It must stay VISIBLE:
                // a TextureView only creates its SurfaceTexture when it is actually drawn, and neither
                // GONE nor INVISIBLE views are drawn, so in either state the decoder has no surface and
                // onRenderedFirstFrame never fires (the player still reaches STATE_READY, since
                // buffering needs no surface).
                root.addView(previewView, 0, new android.widget.FrameLayout.LayoutParams(1, 1));
                // Rounded corners matching the hero's CSS border-radius (sent by the page).
                previewView.setOutlineProvider(new android.view.ViewOutlineProvider() {
                    @Override public void getOutline(View v, android.graphics.Outline o) {
                        float r = (float) (previewRadiusFrac * (webView != null ? webView.getWidth() : 0));
                        o.setRoundRect(0, 0, v.getWidth(), v.getHeight(), Math.max(0f, r));
                    }
                });
                previewView.setClipToOutline(true);
                previewView.setAlpha(0f);
                previewView.setVisibility(View.VISIBLE);
            }
            if (previewPlayer == null) {
                androidx.media3.datasource.DefaultHttpDataSource.Factory http =
                        new androidx.media3.datasource.DefaultHttpDataSource.Factory()
                        .setUserAgent("BYOPlayerPro/3 (Linux; Android) ExoPlayer")
                        .setAllowCrossProtocolRedirects(true)
                        .setConnectTimeoutMs(12000).setReadTimeoutMs(20000);
                androidx.media3.exoplayer.source.DefaultMediaSourceFactory msf =
                        new androidx.media3.exoplayer.source.DefaultMediaSourceFactory(
                                new androidx.media3.datasource.DefaultDataSource.Factory(MainActivity.this, http));
                androidx.media3.exoplayer.DefaultRenderersFactory rf =
                        new androidx.media3.exoplayer.DefaultRenderersFactory(MainActivity.this)
                        .setExtensionRendererMode(androidx.media3.exoplayer.DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)
                        .setEnableDecoderFallback(true);
                // Small buffers: a preview should start fast and not hoard memory/bandwidth.
                // ExoPlayer's DefaultLoadControl requires minBufferMs >= bufferForPlaybackAfterRebufferMs
                // (and >= bufferForPlaybackMs); the previous values (2000, _, _, 2500) violated that and
                // threw an IllegalArgumentException the instant the preview player was first built, on
                // every device and every title -- which is exactly why the preview never once showed a
                // frame and Featured always fell back to the still backdrop.
                androidx.media3.exoplayer.DefaultLoadControl lc =
                        new androidx.media3.exoplayer.DefaultLoadControl.Builder()
                        .setBufferDurationsMs(2500, 12000, 500, 1500)
                        .setPrioritizeTimeOverSizeThresholds(true).build();
                previewPlayer = new androidx.media3.exoplayer.ExoPlayer.Builder(MainActivity.this, rf)
                        .setMediaSourceFactory(msf).setLoadControl(lc).build();
                previewPlayer.setVideoTextureView(previewView);
                previewPlayer.setRepeatMode(androidx.media3.common.Player.REPEAT_MODE_ALL);
                previewPlayer.addListener(new androidx.media3.common.Player.Listener() {
                    @Override public void onPlaybackStateChanged(int st) {
                        if (st==androidx.media3.common.Player.STATE_IDLE) {
                            // previewUrl is cleared (synchronously, before this async callback fires) by
                            // doPreviewStop() -- i.e. by OUR OWN cleanup, whether that's the page moving
                            // on after its 12s "no frame" timeout, swapping titles, or leaving Home. That
                            // cleanup already set a meaningful diagnostic (e.g. "failed: no frame in
                            // 12s"); reporting "idle" here would just stomp it back to a blank "idle"
                            // with nothing to go on. So: nothing new to report on an intentional stop.
                            if (previewUrl == null) return;
                            // Otherwise this IDLE was NOT something we asked for -- the player dropped
                            // back to idle on its own, which (after prepare()) almost always means a
                            // fatal error (bad URL, unopenable source, network error). Surface the real
                            // reason instead of a blank "idle".
                            androidx.media3.common.PlaybackException err = previewPlayer.getPlayerError();
                            if (err != null) { reportPreview("idle", "err=" + err.getErrorCodeName()); return; }
                        }
                        String s = st==androidx.media3.common.Player.STATE_READY?"ready":st==androidx.media3.common.Player.STATE_BUFFERING?"buffering":st==androidx.media3.common.Player.STATE_ENDED?"ended":"idle";
                        reportPreview(s, "");
                        // (The ~90s intro skip now happens in onRenderedFirstFrame, after a picture is up.)
                    }
                    @Override public void onVideoSizeChanged(androidx.media3.common.VideoSize vs) {
                        previewVidW = (int) Math.round(vs.width * (vs.pixelWidthHeightRatio > 0 ? vs.pixelWidthHeightRatio : 1f));
                        previewVidH = vs.height;
                        applyPreviewCrop();
                    }
                    @Override public void onRenderedFirstFrame() {
                        // Real picture is on screen for the first time on this title: fade it in.
                        boolean first = !previewHasFrame;
                        previewHasFrame = true;
                        try { previewView.animate().alpha(1f).setDuration(350).start(); } catch (Exception ignored) {}
                        if (first) reportPreview("playing", "");
                    }
                    @Override public void onPlayerError(androidx.media3.common.PlaybackException e) {
                        previewHasFrame = false;
                        try { previewView.setAlpha(0f); } catch (Exception ignored) {}
                        reportPreview("error", e.getErrorCodeName());
                    }
                });
            }
        } catch (Exception e) { reportPreview("error", "BUILD_" + e.getClass().getSimpleName()); }
    }
    private void doPreviewStart(String url, double xCss, double yCss, double wCss, double hCss, boolean muted) {
        if (url == null || url.length() == 0) return;
        try {
            ensurePreviewPlayer();
            if (previewPlayer == null || previewView == null) return;
            boolean same = url.equals(previewUrl) && previewPlayer.getPlaybackState() != androidx.media3.common.Player.STATE_IDLE;
            previewPlayer.setVolume(muted ? 0f : 1f);
            if (!same) {
                previewUrl = url;
                previewVidW = 0; previewVidH = 0;
                previewHasFrame = false;
                previewView.setAlpha(0f);   // drawn (so the decoder has a surface) but transparent until a real frame renders
                // Open 20 minutes in, requested at prepare() time so there is ONE buffering pass (a
                // start-at-0-then-seek costs a second one and was the visible delay). A VOD movie then
                // opens on real footage instead of logos/titles; ExoPlayer clamps the position for a
                // live stream or a clip shorter than that, and REPEAT_MODE_ALL loops it from the start.
                previewPlayer.setMediaItem(androidx.media3.common.MediaItem.fromUri(android.net.Uri.parse(url)), PREVIEW_START_MS);
                previewPlayer.prepare();
                previewPlayer.setPlayWhenReady(true);
            }
            // Always VISIBLE (alpha governs whether anything shows); doPreviewRect may still switch
            // it to INVISIBLE while the page says the hero is covered.
            previewView.setVisibility(View.VISIBLE);
            doPreviewRect(xCss, yCss, wCss, hCss);   // may set INVISIBLE if the page says it's covered
        } catch (Exception e) { reportPreview("error", "START_" + e.getClass().getSimpleName()); }
    }
    // Centre-crop the video inside the hero rectangle (fill it, trim the overflow), like a trailer banner.
    private void applyPreviewCrop() {
        try {
            if (previewView == null) return;
            int W = previewView.getWidth(), H = previewView.getHeight();
            if (W <= 0 || H <= 0 || previewVidW <= 0 || previewVidH <= 0) return;
            float scale = Math.max((float) W / previewVidW, (float) H / previewVidH);
            float sx = (previewVidW * scale) / W, sy = (previewVidH * scale) / H;
            android.graphics.Matrix m = new android.graphics.Matrix();
            m.setScale(sx, sy, W / 2f, H / 2f);
            previewView.setTransform(m);
        } catch (Exception ignored) {}
    }
    // The web side sends the hero rectangle as FRACTIONS of the viewport (0..1). Multiply by the real
    // WebView pixel size to place the native video exactly over the hero, with no scale guessing.
    private void doPreviewRect(double fx, double fy, double fw, double fh) {
        if (previewView == null || webView == null) return;
        try {
            int W = webView.getWidth(), H = webView.getHeight();
            if (W <= 0 || H <= 0) return;
            // Zero rect = the page wants it hidden for now (hero scrolled under the menu, or a popup is open).
            if (fw <= 0 || fh <= 0) { if (previewView.getVisibility() == View.VISIBLE) previewView.setVisibility(View.INVISIBLE); return; }
            if (previewView.getVisibility() == View.INVISIBLE) previewView.setVisibility(View.VISIBLE);
            int x = (int) Math.round(fx * W), y = (int) Math.round(fy * H);
            int w = (int) Math.max(1, Math.round(fw * W)), h = (int) Math.max(1, Math.round(fh * H));
            android.widget.FrameLayout.LayoutParams lp =
                    new android.widget.FrameLayout.LayoutParams(w, h);
            lp.leftMargin = x; lp.topMargin = y;
            android.widget.FrameLayout.LayoutParams cur = (android.widget.FrameLayout.LayoutParams) previewView.getLayoutParams();
            if (cur != null && cur.width == w && cur.height == h && cur.leftMargin == x && cur.topMargin == y) return;
            previewView.setLayoutParams(lp);
            previewView.invalidateOutline();
            previewView.post(new Runnable() { public void run() { applyPreviewCrop(); } });
        } catch (Exception ignored) {}
    }
    void setCssViewportW(double w) { cssViewportW = w; }
    private double previewRadiusFrac = 0;
    private void doPreviewHole(boolean on, String colors) {
        try {
            if (!on || webView == null) return;   // closing needs nothing native: the page is opaque again
            int[] cols = parseRgbList(colors);
            android.graphics.drawable.Drawable bg = cols.length >= 2
                    ? new android.graphics.drawable.GradientDrawable(android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM, cols)
                    : new android.graphics.drawable.ColorDrawable(cols.length == 1 ? cols[0] : 0xFF04101F);
            root.setBackground(bg);
            webView.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        } catch (Exception ignored) {}
    }
    private static int[] parseRgbList(String s) {
        java.util.ArrayList<Integer> out = new java.util.ArrayList<>();
        if (s != null) for (String part : s.split(";")) {
            String[] c = part.trim().split(",");
            if (c.length < 3) continue;
            try { out.add(android.graphics.Color.rgb((int) Double.parseDouble(c[0].trim()), (int) Double.parseDouble(c[1].trim()), (int) Double.parseDouble(c[2].trim()))); } catch (Exception ignored) {}
        }
        int[] a = new int[out.size()]; for (int i = 0; i < a.length; i++) a[i] = out.get(i); return a;
    }
    private void reportUpdate(final String state, final int pct) { reportUpdate(state, pct, 0L, 0L); }
    private void reportUpdate(final String state, final int pct, final long got, final long total) {
        final String js = "window.__byoUpdate&&window.__byoUpdate('" + state + "'," + pct + "," + got + "," + total + ")";
        runOnUiThread(new Runnable() { public void run() { try { if (webView != null) webView.evaluateJavascript(js, null); } catch (Exception ignored) {} } });
    }
    private void doDownloadInstall(String url) {
        try {
            reportUpdate("downloading", 0);
            java.io.File dir = new java.io.File(getExternalCacheDir() != null ? getExternalCacheDir() : getCacheDir(), "updates");
            dir.mkdirs();
            java.io.File apk = new java.io.File(dir, "byoplayer-update.apk");
            if (apk.exists()) apk.delete();
            java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
            c.setInstanceFollowRedirects(true);
            // Ask for the UNcompressed file: with gzip the size is unknown and no percentage can be shown.
            c.setRequestProperty("Accept-Encoding", "identity");
            c.setConnectTimeout(20000); c.setReadTimeout(60000);
            c.connect();
            int code = c.getResponseCode();
            if (code / 100 != 2) { reportUpdate("error", code); return; }
            long total = c.getContentLength();
            reportUpdate("downloading", 0, 0L, total);
            java.io.InputStream in = c.getInputStream();
            java.io.FileOutputStream out = new java.io.FileOutputStream(apk);
            byte[] buf = new byte[65536]; int n, lastPct = -1; long got = 0, lastMs = 0;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n); got += n;
                long now = System.currentTimeMillis();
                if (total > 0) { int p = (int) (got * 100L / total); if (p != lastPct) { lastPct = p; reportUpdate("downloading", p, got, total); } }
                else if (now - lastMs > 400) { lastMs = now; reportUpdate("downloading", -1, got, 0L); }
            }
            reportUpdate("downloading", 100, got, total > 0 ? total : got);
            out.flush(); out.close(); in.close(); c.disconnect();
            reportUpdate("installing", 100);
            // Launch the package installer. Uses a FileProvider content:// URI (required on API 24+).
            android.net.Uri uri = androidx.core.content.FileProvider.getUriForFile(
                    MainActivity.this, getPackageName() + ".fileprovider", apk);
            final Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            runOnUiThread(new Runnable() { public void run() {
                try {
                    // On Android 8+ the app needs permission to request installs; send the user to grant it
                    // if it's not yet allowed, otherwise the installer won't open.
                    if (android.os.Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                        Intent perm = new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                android.net.Uri.parse("package:" + getPackageName()));
                        perm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        try { startActivity(perm); } catch (Exception ignored) {}
                        reportUpdate("needs_permission", 0);
                        return;
                    }
                    final java.io.File apkF = apk;
                    new Thread(new Runnable() { public void run() {
                        try { installViaSession(apkF); }
                        catch (Exception se) { runOnUiThread(new Runnable() { public void run() { try { startActivity(i); } catch (Exception e2) { reportUpdate("error", -1); } } }); }
                    } }).start();
                } catch (Exception e) { reportUpdate("error", -1); }
            } });
        } catch (Exception e) { reportUpdate("error", -1); }
    }
    private void reportPreview(final String state, final String detail) {
        try {
            final String js = "window.__byoPreview&&window.__byoPreview('" + state + "','" + detail.replace("'","") + "')";
            runOnUiThread(new Runnable() { public void run() { try { if (webView != null) webView.evaluateJavascript(js, null); } catch (Exception ignored) {} } });
        } catch (Exception ignored) {}
    }
    private void doPreviewStop() {
        try {
            previewHasFrame = false;
            // previewUrl MUST be cleared BEFORE calling player.stop(): onPlaybackStateChanged's IDLE
            // branch treats previewUrl==null as "this is our own intentional stop, don't report it" --
            // but stop() can dispatch that callback inline, in which case clearing previewUrl AFTER stop()
            // (the previous order) meant the callback still saw the old url and logged a bare "idle"
            // anyway, exactly the noise this check was meant to suppress.
            previewUrl = null;
            if (previewView != null) { previewView.animate().cancel(); previewView.setAlpha(0f); previewView.setVisibility(View.GONE); }
            if (previewPlayer != null) { previewPlayer.setPlayWhenReady(false); previewPlayer.stop(); }
        } catch (Exception ignored) {}
    }

    /**
     * BACK (phone back gesture/button or TV remote) goes to the web app's own
     * back handling — close the player, leave a detail page, close a dialog, and
     * on Home show the app's "Exit?" confirmation — instead of killing the app.
     */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null) {
            webView.evaluateJavascript(
                "(function(){try{if(window.Nav&&Nav.onBack){Nav.onBack();return 1;}}catch(e){}return 0;})()",
                null);
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public void onBackPressed() {
        if (webView != null) {
            webView.evaluateJavascript(
                "(function(){try{if(window.Nav&&Nav.onBack){Nav.onBack();return 1;}}catch(e){}return 0;})()",
                null);
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_PLAY) return;
        String status = (data != null && data.getStringExtra("status") != null) ? data.getStringExtra("status") : "ok";
        long pos = data != null ? data.getLongExtra("posMs", 0) : 0;
        long dur = data != null ? data.getLongExtra("durMs", 0) : 0;
        int ch = data != null ? data.getIntExtra("chIndex", 0) : 0;
        int ep = data != null ? data.getIntExtra("epIndex", 0) : 0;
        String err = data != null && data.getStringExtra("err") != null ? data.getStringExtra("err").replaceAll("[^A-Za-z0-9 ._@:-]", "") : "";
        String thumb = data != null ? data.getStringExtra("thumb") : null;
        String th = (thumb != null && thumb.matches("^data:image/jpeg;base64,[A-Za-z0-9+/=]+$")) ? ("'" + thumb + "'") : "null";
        String fav = data != null && data.getStringExtra("fav") != null ? data.getStringExtra("fav").replaceAll("[^01]", "") : "";
        int pick = data != null ? data.getIntExtra("pick", -1) : -1;
        boolean played = data != null && data.getBooleanExtra("played", true);
        String js = "window.__byoNativePlayed=" + (played ? "true" : "false") + ";window.__byoNativeResult&&window.__byoNativeResult('" + status.replaceAll("[^A-Za-z]", "") + "'," + pos + "," + dur + "," + ch + "," + th + "," + ep + ",'" + err + "','" + fav + "'," + pick + ")";
        if (webView == null || rebuildPending) pendingResultJs = js;
        else webView.evaluateJavascript(js, null);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) webView.onPause();
        // Free the preview's video decoder and buffers while away (TVs have few decoders and little RAM);
        // the page restarts the preview when Home is shown again.
        try { doPreviewStop(); if (previewPlayer != null) { previewPlayer.release(); previewPlayer = null; } previewUrl = null; } catch (Exception ignored) {}
        // While a movie/episode plays in the native player, freeze the page's JavaScript timers (library
        // refreshes, guide and score polling) so the background page can't eat memory and get killed.
        // Live TV keeps them running so goal alerts still reach the player.
        if (webView != null && launchingPlayer && !playingLive) { webView.pauseTimers(); timersPaused = true; }
        launchingPlayer = false;
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (rebuildPending || webView == null) { rebuildPending = false; buildWebView(true); }
        launchingPlayer = false;
        if (webView != null) { webView.resumeTimers(); timersPaused = false; webView.requestFocus(); }
        if (webView != null) {
            webView.onResume();
            // hide system UI for an immersive TV experience
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Make sure the remote's arrows and OK always reach the page when the app is on screen.
        if (hasFocus && webView != null && !webView.hasFocus()) webView.requestFocus();
    }

    @Override
    protected void onDestroy() {
        try { if (previewPlayer != null) { previewPlayer.release(); previewPlayer = null; } } catch (Exception ignored) {}
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
