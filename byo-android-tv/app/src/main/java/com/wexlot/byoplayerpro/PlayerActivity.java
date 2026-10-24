package com.wexlot.byoplayerpro;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Build;
import android.util.Base64;
import android.view.PixelCopy;
import android.view.SurfaceView;
import java.io.ByteArrayOutputStream;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.trackselection.AdaptiveTrackSelection;
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector;
import androidx.media3.exoplayer.upstream.DefaultBandwidthMeter;
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy;
import androidx.media3.ui.PlayerView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Native full-screen player for EVERYTHING on Android: live channels, movies, episodes, catch-up,
 * from Emby/Jellyfin, Xtream or any M3U playlist.
 *
 * "Plays like YouTube, never pauses":
 *  - deep buffer (VOD: up to 5 min ahead; live: sits ~20 s behind the edge as a safety runway)
 *  - adaptive quality: HLS/DASH sources with several variants are switched automatically by a
 *    conservative ABR (uses 70% of measured bandwidth, slow to go up, quick to go down)
 *  - if it still stalls, quality is capped down instead of pausing again
 *  - Emby/Jellyfin: extra server-made levels (1080p/720p/480p/360p) when the original is too heavy
 *  - automatic reconnect on network errors; live: rejoin the live edge when it falls behind
 * Result extras: status ("ok"|"ended"|"error"), posMs, durMs, chIndex.
 */
@OptIn(markerClass = UnstableApi.class)
public class PlayerActivity extends Activity {

    public static final String EXTRA_URL = "url", EXTRA_TITLE = "title", EXTRA_SUB = "sub", EXTRA_START = "startMs",
            EXTRA_QUALITIES = "qualities", EXTRA_LIVE = "live", EXTRA_CHANNELS = "channels", EXTRA_CH_INDEX = "chIndex", EXTRA_HEADERS = "headers", EXTRA_DRM = "drm", EXTRA_EPISODES = "episodes", EXTRA_META = "meta", EXTRA_GUARD = "guard";

    private static class Q { String label; String url; long bitrate; Q(String l, String u, long b){ label=l; url=u; bitrate=b; } }
    private static class Ch { String title, sub, url; JSONObject headers, drm; Ch(String t, String s, String u, JSONObject h, JSONObject d){ title=t; sub=s; url=u; headers=h; drm=d; } }
    // ClearKey protection for the current item: {type, keys:[{kid,key}] (hex), licenseUrl}
    private JSONObject baseDrm, curDrm;
    // Per-stream HTTP headers from the playlist (#EXTVLCOPT / #EXTHTTP / KODIPROP / url|User-Agent=...).
    private DefaultHttpDataSource.Factory http;
    private JSONObject baseHeaders;
    private static final String DEFAULT_UA = "BYOPlayerPro/3 (Linux; Android) ExoPlayer";

    private final List<Q> qualities = new ArrayList<>();   // Emby levels: [0]=original
    private final List<Ch> channels = new ArrayList<>();   // live zapping list
    // Series: the episodes that follow the one being played, so the player rolls on to the next one.
    private static class Ep { String title, sub, url; long startMs; Ep(String t, String s, String u, long st){ title=t; sub=s; url=u; startMs=st; } }
    private final List<Ep> nextEps = new ArrayList<>();
    // What's playing (for the pause info card): type, plot, poster, season/episode label, year.
    private JSONObject meta = new JSONObject();
    private final List<JSONObject> nextMeta = new ArrayList<>();
    private int epAdvanced = 0;          // how many episodes we've moved on from the one we were opened with
    private int qIndex = 0, chIndex = 0;
    private boolean live = false, autoQuality = true;
    private long capBitrate = Long.MAX_VALUE;               // ABR cap after stalls (any adaptive source)

    private ExoPlayer player;
    private DefaultTrackSelector selector;
    private DefaultBandwidthMeter meter;
    private StreamTuning.ContinuityLoadControl loadCtl;
    private TextView favBtn; private boolean favOn = false, favChanged = false;   // ★ Favourite (movie, or the series of an episode)
    private long lastStallAt = 0;              // last time playback stalled after it had started
    private boolean waitingNet = false;        // the internet dropped: waiting for it to come back
    private android.net.ConnectivityManager.NetworkCallback netCb;
    private PlayerView view;
    private View topBar;
    private TextView titleView, subView, errorText, qualityBtn;
    private ProgressBar spinner;
    private boolean finishing = false, everPlayed = false;
    private final List<Long> rebuffers = new ArrayList<>();
    private long lastSeekAt = 0, bufferingSince = 0, lastSwitchAt = 0;
    private int retries = 0;
    private final Handler h = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemUi();

        Intent in = getIntent();
        try { String gj = in.getStringExtra(EXTRA_GUARD); if (gj != null) guard = new JSONObject(gj); } catch (Exception ignored) {}
        if (guard != null) h.postDelayed(accessCheck, 20000);
        String url = in.getStringExtra(EXTRA_URL);
        String title = in.getStringExtra(EXTRA_TITLE);
        String sub = in.getStringExtra(EXTRA_SUB);
        long startMs = in.getLongExtra(EXTRA_START, 0);
        live = in.getBooleanExtra(EXTRA_LIVE, false);
        qualities.add(new Q("Original", url, Long.MAX_VALUE));
        try { String qj = in.getStringExtra(EXTRA_QUALITIES);
            if (qj != null) { JSONArray a = new JSONArray(qj);
                for (int i = 0; i < a.length(); i++) { JSONObject o = a.getJSONObject(i);
                    qualities.add(new Q(o.optString("label"), o.optString("url"), o.optLong("bitrate"))); } }
        } catch (Exception ignored) {}
        try { String cj = in.getStringExtra(EXTRA_CHANNELS);
            if (cj != null) { JSONArray a = new JSONArray(cj);
                for (int i = 0; i < a.length(); i++) { JSONObject o = a.getJSONObject(i);
                    channels.add(new Ch(o.optString("title"), o.optString("sub"), o.optString("url"), o.optJSONObject("headers"), o.optJSONObject("drm"))); } }
            chIndex = in.getIntExtra(EXTRA_CH_INDEX, 0);
        } catch (Exception ignored) {}

        try { String ej = in.getStringExtra(EXTRA_EPISODES);
            if (ej != null && !live) { JSONArray a = new JSONArray(ej);
                for (int i = 0; i < a.length(); i++) { JSONObject o = a.getJSONObject(i);
                    if (o.optString("url").length() > 0) { nextEps.add(new Ep(o.optString("title"), o.optString("sub"), o.optString("url"), o.optLong("startMs", 0))); JSONObject m = o.optJSONObject("meta"); nextMeta.add(m != null ? m : new JSONObject()); } } }
        } catch (Exception ignored) {}
        try { String mj = in.getStringExtra(EXTRA_META); if (mj != null && mj.length() > 2) meta = new JSONObject(mj); } catch (Exception ignored) {}
        try { allEps = meta.optJSONArray("allEps"); curEp = meta.optInt("curEp", -1); meta.remove("allEps"); if (allEps != null && (allEps.length() < 2 || curEp < 0)) allEps = null; } catch (Exception ignored) { allEps = null; }
        try { String dj = in.getStringExtra(EXTRA_DRM); if (dj != null && dj.length() > 2) baseDrm = new JSONObject(dj); } catch (Exception ignored) {}
        try { String hj = in.getStringExtra(EXTRA_HEADERS); if (hj != null && hj.length() > 2) baseHeaders = new JSONObject(hj); } catch (Exception ignored) {}
        buildUi(title, sub);

        // ---- engine ----
        http = new DefaultHttpDataSource.Factory()
                .setUserAgent(DEFAULT_UA)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(25000);
        DefaultMediaSourceFactory msf = new DefaultMediaSourceFactory(new DefaultDataSource.Factory(this, http));
        msf.setLoadErrorHandlingPolicy(new StreamTuning.ContinuityErrorPolicy());
        final androidx.media3.exoplayer.drm.DefaultDrmSessionManagerProvider drmDefault = new androidx.media3.exoplayer.drm.DefaultDrmSessionManagerProvider();
        drmDefault.setDrmHttpDataSourceFactory(http);
        msf.setDrmSessionManagerProvider(mediaItem -> {
            // ClearKey keys given in the playlist: answer the licence request locally.
            try {
                if (curDrm != null && "clearkey".equals(curDrm.optString("type")) && curDrm.optString("licenseUrl").isEmpty()) {
                    JSONArray ks = curDrm.optJSONArray("keys");
                    if (ks != null && ks.length() > 0) {
                        JSONArray out = new JSONArray();
                        for (int i = 0; i < ks.length(); i++) { JSONObject k = ks.getJSONObject(i);
                            out.put(new JSONObject().put("kty", "oct").put("kid", b64url(k.optString("kid"))).put("k", b64url(k.optString("key")))); }
                        byte[] resp = new JSONObject().put("keys", out).put("type", "temporary").toString().getBytes("UTF-8");
                        return new androidx.media3.exoplayer.drm.DefaultDrmSessionManager.Builder()
                                .setUuidAndExoMediaDrmProvider(C.CLEARKEY_UUID, androidx.media3.exoplayer.drm.FrameworkMediaDrm.DEFAULT_PROVIDER)
                                .build(new androidx.media3.exoplayer.drm.LocalMediaDrmCallback(resp));
                    }
                }
            } catch (Exception ignored) {}
            return drmDefault.get(mediaItem);
        });
        DefaultRenderersFactory rf = new DefaultRenderersFactory(this)
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)
                .setEnableDecoderFallback(true);
        // Buffer, ABR and segment-error rules live in StreamTuning (see the notes there for the numbers).
        loadCtl = StreamTuning.buildLoadControl(this, live);
        meter = StreamTuning.buildBandwidthMeter(this);
        selector = StreamTuning.buildTrackSelector(this);
        // The audio language picked last time is preferred whenever a stream offers it.
        try { String al = getSharedPreferences("byo_player", MODE_PRIVATE).getString("audioLang", ""); if (al.length() > 0) selector.setParameters(selector.buildUponParameters().setPreferredAudioLanguage(al)); } catch (Exception ignored) {}
        player = new ExoPlayer.Builder(this, rf)
                .setMediaSourceFactory(msf)
                .setLoadControl(loadCtl)
                .setBandwidthMeter(meter)
                .setTrackSelector(selector)
                .setSeekBackIncrementMs(10000)
                .setSeekForwardIncrementMs(10000)
                .build();
        player.setVideoScalingMode(C.VIDEO_SCALING_MODE_SCALE_TO_FIT);
        view.setPlayer(player);
        player.addListener(listener);

        watchNetwork();
        h.postDelayed(upgradeCheck, 10000);
        load(url, startMs);
    }

    // ---------------------------------------------------------------- playback

    private static String b64url(String hex) {
        try { hex = hex.replace("-", ""); byte[] b = new byte[hex.length() / 2];
            for (int i = 0; i < b.length; i++) b[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
            return android.util.Base64.encodeToString(b, android.util.Base64.URL_SAFE | android.util.Base64.NO_PADDING | android.util.Base64.NO_WRAP);
        } catch (Exception e) { return ""; }
    }

    private MediaItem item(String url) {
        MediaItem.Builder b = new MediaItem.Builder().setUri(Uri.parse(url));
        if (url != null && url.toLowerCase().contains(".mpd")) b.setMimeType(androidx.media3.common.MimeTypes.APPLICATION_MPD);
        if (curDrm != null && "clearkey".equals(curDrm.optString("type"))) {
            MediaItem.DrmConfiguration.Builder d = new MediaItem.DrmConfiguration.Builder(C.CLEARKEY_UUID);
            String lic = curDrm.optString("licenseUrl");
            if (!lic.isEmpty()) d.setLicenseUri(lic);
            b.setDrmConfiguration(d.build());
        }
        if (live) b.setLiveConfiguration(new MediaItem.LiveConfiguration.Builder()
                .setTargetOffsetMs(20000).setMinOffsetMs(8000)
                .setMinPlaybackSpeed(0.97f).setMaxPlaybackSpeed(1.03f).build());
        return b.build();
    }

    private void applyHeaders(JSONObject hdr) {
        if (http == null) return;
        String ua = useBrowserUa ? browserUa() : DEFAULT_UA;
        java.util.Map<String, String> props = new java.util.HashMap<>();
        if (hdr != null) {
            java.util.Iterator<String> it = hdr.keys();
            while (it.hasNext()) { String k = it.next(); String v = hdr.optString(k, "");
                if (k == null || v == null || v.isEmpty()) continue;
                if (k.equalsIgnoreCase("User-Agent")) ua = v; else props.put(k, v); }
        }
        http.setUserAgent(ua);
        http.setDefaultRequestProperties(props);
    }

    private void load(String url, long posMs) {
        if (errorText != null) errorText.setVisibility(View.GONE);
        unavailableShown = false;
        h.removeCallbacks(startTimeout);   // no start deadline: slow channels (VPN, distant servers) get all the time they need, as before
        h.removeCallbacks(slowHint); if (live) h.postDelayed(slowHint, 25000);
        curDrm = (live && !channels.isEmpty() && chIndex < channels.size()) ? channels.get(chIndex).drm : baseDrm;
        applyHeaders(live && !channels.isEmpty() && chIndex < channels.size() && channels.get(chIndex).headers != null ? channels.get(chIndex).headers : (live && !channels.isEmpty() && chIndex < channels.size() ? null : baseHeaders));
        if (posMs > 0 && !live) player.setMediaItem(item(url), posMs); else player.setMediaItem(item(url));
        player.prepare();
        player.setPlayWhenReady(true);
    }

    private final Player.Listener listener = new Player.Listener() {
        @Override public void onPlaybackStateChanged(int state) {
            spinner.setVisibility(state == Player.STATE_BUFFERING ? View.VISIBLE : View.GONE);
            if (state == Player.STATE_READY) { everPlayed = true; retries = 0; if (waitingNet) { waitingNet = false; h.removeCallbacks(netPoll); } errorText.setVisibility(View.GONE); unavailableShown = false; bufferingSince = 0; h.removeCallbacks(stallCheck); h.removeCallbacks(startTimeout); h.removeCallbacks(slowHint); }
            if (state == Player.STATE_ENDED) { if (live) reconnect("Reconnecting…"); else if (epAdvanced < nextEps.size()) showUpNext(); else finishWith("ended"); }
            if (state == Player.STATE_BUFFERING && everPlayed) {
                long now = System.currentTimeMillis();
                if (now - lastSeekAt > 4000 && now - lastSwitchAt > 8000) {
                    rebuffers.add(now); bufferingSince = now; lastStallAt = now; if (loadCtl != null) loadCtl.noteStall();
                    h.removeCallbacks(stallCheck); h.postDelayed(stallCheck, 5000);
                    int recent = 0; for (long t : rebuffers) if (now - t < 120000) recent++;
                    if (recent >= 2) stepDown();
                }
            }
        }
        @Override public void onIsPlayingChanged(boolean isPlaying) { h.post(() -> updateInfoCard()); }
        @Override public void onPlayWhenReadyChanged(boolean pwr, int reason) { h.post(() -> { if (!pwr && view != null) view.showController(); updateInfoCard(); }); }
        @Override public void onPositionDiscontinuity(Player.PositionInfo o, Player.PositionInfo n, int reason) {
            if (reason == Player.DISCONTINUITY_REASON_SEEK) lastSeekAt = System.currentTimeMillis();
        }
        @Override public void onTracksChanged(Tracks tracks) { updateQualityLabel(); }
        @Override public void onPlayerError(PlaybackException error) {
            spinner.setVisibility(View.GONE);
            try { int hs0 = httpStatus(error); String u0 = live && !channels.isEmpty() && chIndex < channels.size() ? channels.get(chIndex).url : (qualities.isEmpty() ? "" : qualities.get(qIndex).url);
                String host = ""; try { host = android.net.Uri.parse(u0).getHost(); } catch (Exception ignored) {}
                lastErr = error.getErrorCodeName().replace("ERROR_CODE_", "") + (hs0 > 0 ? " HTTP " + hs0 : "") + (host != null && !host.isEmpty() ? " @ " + host : ""); } catch (Exception ignored) {}
            // Live fell behind the playlist window → simply rejoin the live edge.
            if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                player.seekToDefaultPosition(); player.prepare(); return; }
            // Internet gone: don't burn retries or show an error. Wait for it to come back, then carry on.
            if (isNetworkError(error) && !online()) { waitForNetwork(); return; }
            // Emby: a level failed → try the next lighter one.
            if (qualities.size() > 1 && (qIndex > 0 || !everPlayed) && qIndex + 1 < qualities.size()) {
                switchTo(qIndex + 1, qIndex == 0 ? "Optimising stream" : "Trying a lighter stream"); return; }
            // Live channel that never started: only hand over to the web player when the stream format is
            // the problem (it has its own decoders). If the server refused it or isn't answering, the web
            // player would just sit on "Getting it ready…", so say so here and let the user change channel.
            // Live channel that never started. Many IPTV servers refuse unknown players (HTTP 4xx for an
            // "ExoPlayer" user agent), so first retry once as a normal browser; if it still won't open,
            // hand over to the app's web player (as before), which plays most of these channels.
            if (live && !everPlayed) {
                int hs = httpStatus(error);
                if (!useBrowserUa && hs >= 400 && hs < 500 && !hasCustomUa()) { useBrowserUa = true; retries = 0; reconnect(null); return; }
                // A clear refusal (4xx) won't change by retrying: move on straight away (alternates / web player).
                if (retries < 1 && !(hs >= 400 && hs < 500)) { reconnect(null); return; }
                finishWith("error"); return; }
            // Never started at all → let the web player try (its own recovery / transcode path).
            if (!everPlayed && retries >= 1) { finishWith("error"); return; }
            // Connection too slow for this quality: drop a level first, then retry at the same spot.
            if (isNetworkError(error) && everPlayed) stepDown();
            // Network blip → reconnect quietly at the same spot (up to 6 times), like a streaming app.
            if (retries < 6) { reconnect(null); return; }
            errorText.setText("This stream isn't responding right now.\nTap back to return" + (live ? ", or change channel." : "."));
            errorText.setVisibility(View.VISIBLE);
        }
    };

    private static boolean isFormatError(PlaybackException e) {
        int c = e.errorCode;
        return (c >= 3000 && c < 4000)   // parsing: container / manifest unsupported or malformed
            || (c >= 4000 && c < 5000);  // decoding: codec not supported on this TV
    }
    private int httpStatus(PlaybackException e) {
        Throwable t = e.getCause();
        while (t != null) {
            if (t instanceof androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException)
                return ((androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException) t).responseCode;
            t = t.getCause();
        }
        return 0;
    }
    // A clear "this channel isn't working" card instead of an endless spinner.
    private void showUnavailable(PlaybackException e) {
        spinner.setVisibility(View.GONE); h.removeCallbacks(startTimeout);
        String why;
        int code = e == null ? 0 : httpStatus(e);
        CharSequence ttl = titleView != null ? titleView.getText() : "";
        boolean geo = ttl != null && ttl.toString().contains("\u24BC");   // Ⓖ = marked geo-blocked by the playlist
        if (code == 403 || code == 451 || geo) why = "The provider is blocking it from your location" + (geo ? " (this channel is marked \u24BC, region-locked)." : ".");
        else if (code == 404 || code == 410) why = "Its stream link no longer works (the channel moved or went off air).";
        else if (code >= 500) why = "The channel's server is having problems right now.";
        else if (e == null) why = "It isn't sending any video.";
        else why = "It isn't responding.";
        errorText.setText("This channel isn't available right now.\n" + why + "\n\n" + (channels.size() > 1 ? "UP / DOWN for another channel  \u00B7  OK to try again  \u00B7  BACK to return" : "OK to try again  \u00B7  BACK to return"));
        errorText.setVisibility(View.VISIBLE);
        unavailableShown = true;
    }
    private boolean unavailableShown = false;
    // A live channel still not sending video after 25 s: say so (it keeps trying behind the card).
    // Event channels ("... @ 18 Oct 10:00 AM") only carry video while that event is on.
    private final Runnable slowHint = () -> {
        if (player == null || !live || everPlayed || finishing || unavailableShown) return;
        String t = titleView != null ? String.valueOf(titleView.getText()) : "", sb = subView != null ? String.valueOf(subView.getText()) : "";
        boolean event = t.matches("(?s).*@\\s*\\d{1,2}[ /.-]\\w{2,9}.*") || sb.toLowerCase().contains("event") || t.toLowerCase().contains("ppv");
        errorText.setText((event
                ? "This event channel isn't sending video.\nEvent channels only play while the event is live. Check the date and time in its name."
                : "This channel isn't sending video yet.\nIt may be off air right now, or the provider is slow.")
            + "\n\nStill trying\u2026  " + (channels.size() > 1 ? "UP / DOWN for another channel  \u00B7  BACK to return" : "BACK to return"));
        errorText.setVisibility(View.VISIBLE);
        unavailableShown = true;
    };
    // Support can disable this TV from the console: check every 20 s while playing and stop if it is.
    private JSONObject guard;
    private final Runnable accessCheck = new Runnable() { @Override public void run() {
        if (guard == null || finishing) return;
        final String base = guard.optString("url"), anon = guard.optString("anon"), key = guard.optString("key");
        new Thread(() -> {
            String state = "";
            try {
                java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(base + "/rest/v1/rpc/byo_device_flags").openConnection();
                c.setRequestMethod("POST"); c.setConnectTimeout(8000); c.setReadTimeout(8000); c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json"); c.setRequestProperty("apikey", anon); c.setRequestProperty("Authorization", "Bearer " + anon);
                c.getOutputStream().write(new JSONObject().put("p_device_key", key).toString().getBytes("UTF-8"));
                if (c.getResponseCode() == 200) {
                    java.io.InputStream is = c.getInputStream(); java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream(); byte[] buf = new byte[2048]; int n;
                    while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
                    JSONObject f = new JSONObject(bo.toString("UTF-8")); JSONObject a = f.optJSONObject("access"); if (a != null) state = a.optString("state", "");
                }
            } catch (Exception ignored) {}
            final String st = state;
            h.post(() -> {
                if (finishing) return;
                if ("blocked".equals(st) || "ended".equals(st)) {
                    if (player != null) player.stop();
                    android.widget.Toast.makeText(PlayerActivity.this, "blocked".equals(st) ? "BYO Player has been paused on this TV." : "Your access has ended.", android.widget.Toast.LENGTH_LONG).show();
                    finishWith("paused");
                } else h.postDelayed(accessCheck, 20000);
            });
        }).start();
    } };
    // Live channel still not playing after 20 s of trying: tell the user (it keeps trying behind the card).
    private final Runnable startTimeout = () -> { if (player != null && live && !everPlayed && !finishing) finishWith("error"); };   // let the web player try
    // Sticky for this session: once a provider has needed a browser user agent, keep using it.
    private boolean useBrowserUa = false;   // per channel: reset whenever the channel changes
    private String browserUa() { try { return android.webkit.WebSettings.getDefaultUserAgent(this); } catch (Exception e) { return "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"; } }
    private boolean hasCustomUa() { JSONObject hd = (live && !channels.isEmpty() && chIndex < channels.size() && channels.get(chIndex).headers != null) ? channels.get(chIndex).headers : baseHeaders;
        if (hd == null) return false; java.util.Iterator<String> it = hd.keys(); while (it.hasNext()) if ("user-agent".equalsIgnoreCase(it.next())) return true; return false; }

    private void reconnect(String msg) {
        retries++;
        // First attempt on a movie/episode is a soft retry: re-prepare the same item where it stopped. It
        // keeps the bandwidth estimate and track choice and is quicker than reloading from scratch.
        if (retries == 1 && !live && everPlayed && player != null && player.getPlaybackState() == Player.STATE_IDLE) {
            spinner.setVisibility(View.VISIBLE);
            h.postDelayed(() -> { if (player != null && player.getPlaybackState() == Player.STATE_IDLE) player.prepare(); }, 600);
            return; }
        final long pos = live ? 0 : Math.max(0, player.getCurrentPosition());
        spinner.setVisibility(View.VISIBLE);
        if (msg != null) Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
        h.postDelayed(() -> { if (player != null) { String u = live && !channels.isEmpty() ? channels.get(chIndex).url : qualities.get(qIndex).url; load(u, pos); } },
                Math.min(1000L * retries * retries, 8000L));
    }

    // ---------------------------------------------------------------- network fault recovery

    private static boolean isNetworkError(PlaybackException e) {
        int c = e.errorCode;
        return c >= 2000 && c < 3000;   // IO errors: no connection, timeouts, dropped downloads, HTTP errors
    }
    private boolean online() {
        try {
            android.net.ConnectivityManager cm = (android.net.ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            android.net.NetworkInfo ni = cm == null ? null : cm.getActiveNetworkInfo();
            return ni == null || ni.isConnected();   // unknown counts as online, so we never wait forever by mistake
        } catch (Exception e) { return true; }
    }
    private void waitForNetwork() {
        if (waitingNet) return;
        waitingNet = true;
        spinner.setVisibility(View.VISIBLE);
        errorText.setText("Waiting for your internet connection\u2026\nPlayback carries on by itself as soon as it's back.");
        errorText.setVisibility(View.VISIBLE);
        h.postDelayed(netPoll, 3000);   // backup in case the system callback doesn't fire on this TV
    }
    private void networkBack() {
        if (!waitingNet || finishing || player == null) return;
        waitingNet = false; retries = 0; h.removeCallbacks(netPoll);
        errorText.setVisibility(View.GONE);
        if (live) { load(channels.isEmpty() ? qualities.get(qIndex).url : channels.get(chIndex).url, 0); return; }
        if (player.getPlaybackState() == Player.STATE_IDLE) player.prepare(); else player.play();
    }
    private final Runnable netPoll = () -> { if (!waitingNet) return; if (online()) networkBack(); else h.postDelayed(this.netPoll, 3000); };
    private void watchNetwork() {
        try {
            android.net.ConnectivityManager cm = (android.net.ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            if (cm == null) return;
            netCb = new android.net.ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(android.net.Network n) { h.postDelayed(() -> networkBack(), 1500); }   // give DNS a moment
            };
            cm.registerNetworkCallback(new android.net.NetworkRequest.Builder()
                    .addCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET).build(), netCb);
        } catch (Exception ignored) { netCb = null; }
    }
    private void unwatchNetwork() {
        try { if (netCb != null) ((android.net.ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE)).unregisterNetworkCallback(netCb); } catch (Exception ignored) {}
        netCb = null;
    }

    /**
     * Step quality back UP once the connection has recovered (it used to stay lowered for the rest of
     * the title). Checked every 10 s, and only when all of these hold:
     *  - quality is on Auto and was lowered earlier,
     *  - no stall for 90 s (Emby server levels: 3 min, since that switch reloads the stream),
     *  - at least 20 s is buffered ahead,
     *  - 65% of the measured bandwidth covers the next level up with 20% to spare (30% for Emby).
     * One level at a time, so a short burst of speed can't push it straight back to the top.
     */
    private final Runnable upgradeCheck = new Runnable() { @Override public void run() {
        if (player == null || finishing) return;
        h.postDelayed(this, 10000);
        if (!autoQuality || !player.isPlaying() || waitingNet) return;
        long now = System.currentTimeMillis();
        long est = meter != null ? meter.getBitrateEstimate() : 0;
        long ahead = player.getTotalBufferedDuration();
        if (est <= 0 || ahead < 20000) return;
        if (qualities.size() > 1 && qIndex > 1) {          // Emby: back to the next server level (never straight to Original)
            Q up = qualities.get(qIndex - 1);
            if (now - lastStallAt > 180000 && now - lastSwitchAt > 180000 && up.bitrate < Long.MAX_VALUE && est * 0.65 >= up.bitrate * 1.3)
                switchTo(qIndex - 1, "Quality improved to " + up.label);
            return;
        }
        if (capBitrate == Long.MAX_VALUE || now - lastStallAt < 90000 || now - lastSwitchAt < 90000) return;
        long next = Long.MAX_VALUE;                        // the next rendition above the current cap
        for (Format f : videoFormats()) if (f.bitrate > capBitrate && f.bitrate < next) next = f.bitrate;
        if (next == Long.MAX_VALUE) { capBitrate = Long.MAX_VALUE; }
        else if (est * 0.65 >= next * 1.2) {
            boolean top = true; for (Format f : videoFormats()) if (f.bitrate > next) top = false;
            capBitrate = top ? Long.MAX_VALUE : next;
        } else return;
        lastSwitchAt = now; if (loadCtl != null) loadCtl.reset();
        selector.setParameters(selector.buildUponParameters().setMaxVideoBitrate((int) Math.min(capBitrate, Integer.MAX_VALUE)));
    } };

    /** Single long stall (5 s) → act now rather than waiting for a second one. */
    private final Runnable stallCheck = () -> {
        if (player != null && player.getPlaybackState() == Player.STATE_BUFFERING && bufferingSince > 0) stepDown();
    };

    /** YouTube-style: step down to what the connection sustains instead of pausing again. */
    private void stepDown() {
        if (!autoQuality) return;
        long now = System.currentTimeMillis();
        if (now - lastSwitchAt < 15000) return;
        long est = meter != null ? meter.getBitrateEstimate() : 0;
        // (1) Emby/Jellyfin: server-made lighter levels
        if (qualities.size() > 1) {
            int target = -1;
            for (int i = Math.max(qIndex + 1, 1); i < qualities.size(); i++)
                if (est <= 0 || qualities.get(i).bitrate <= est * 0.65) { target = i; break; }
            if (target < 0) target = Math.min(qIndex + 1, qualities.size() - 1);
            if (target > qIndex) { rebuffers.clear(); switchTo(target, "Adjusted to " + qualities.get(target).label + " for smooth playback"); }
            return;
        }
        // (2) Any adaptive HLS/DASH playlist: cap the ABR below the current variant
        List<Format> v = videoFormats();
        if (v.size() > 1) {
            Format cur = player.getVideoFormat();
            long curBr = cur != null && cur.bitrate > 0 ? cur.bitrate : Long.MAX_VALUE;
            long cap = Math.min(curBr - 1, est > 0 ? (long) (est * 0.65) : curBr - 1);
            long lowest = Long.MAX_VALUE; for (Format f : v) if (f.bitrate > 0) lowest = Math.min(lowest, f.bitrate);
            if (lowest != Long.MAX_VALUE) cap = Math.max(cap, lowest);
            if (cap < capBitrate) {
                capBitrate = cap; lastSwitchAt = now; rebuffers.clear();
                selector.setParameters(selector.buildUponParameters().clearOverridesOfType(C.TRACK_TYPE_VIDEO).setMaxVideoBitrate((int) Math.min(cap, Integer.MAX_VALUE)));
                Toast.makeText(this, "Lowered quality for smooth playback", Toast.LENGTH_SHORT).show();
            }
        }
    }

    private void switchTo(int idx, String msg) {
        if (player == null || idx < 0 || idx >= qualities.size()) return;
        long pos = Math.max(0, player.getCurrentPosition());
        qIndex = idx; lastSwitchAt = System.currentTimeMillis(); bufferingSince = 0;
        h.removeCallbacks(stallCheck);
        load(qualities.get(idx).url, pos);
        updateQualityLabel();
        if (msg != null) Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
    }

    private void zap(int delta) {
        if (channels.size() < 2) return;
        switchTo((chIndex + delta + channels.size()) % channels.size());
    }

    private void switchTo(int idx) {
        chIndex = idx; useBrowserUa = false; lastErr = "";
        Ch c = channels.get(chIndex);
        titleView.setText(c.title); subView.setText(c.sub); subView.setVisibility(c.sub.isEmpty() ? View.GONE : View.VISIBLE);
        everPlayed = false; retries = 0; capBitrate = Long.MAX_VALUE; rebuffers.clear(); lastStallAt = 0; if (loadCtl != null) loadCtl.reset();
        selector.setParameters(selector.buildUponParameters().clearOverridesOfType(C.TRACK_TYPE_VIDEO).setMaxVideoBitrate(Integer.MAX_VALUE));
        qualities.clear(); qualities.add(new Q("Original", c.url, Long.MAX_VALUE)); qIndex = 0;
        load(c.url, 0);
        view.showController();
    }

    // ---------------------------------------------------------------- quality menu

    private List<Format> videoFormats() {
        List<Format> out = new ArrayList<>();
        if (player == null) return out;
        for (Tracks.Group g : player.getCurrentTracks().getGroups())
            if (g.getType() == C.TRACK_TYPE_VIDEO) for (int i = 0; i < g.length; i++) if (g.isTrackSupported(i)) out.add(g.getTrackFormat(i));
        return out;
    }

    private void updateQualityLabel() {
        if (qualityBtn == null || player == null) return;
        List<Format> v = videoFormats();
        boolean show = qualities.size() > 1 || v.size() > 1;
        qualityBtn.setVisibility(show ? View.VISIBLE : View.GONE);
        if (!show) return;
        String cur;
        if (qualities.size() > 1) cur = qualities.get(qIndex).label;
        else { Format f = player.getVideoFormat(); cur = f != null && f.height > 0 ? f.height + "p" : ""; }
        qualityBtn.setText(autoQuality ? ("Auto" + (cur.isEmpty() ? "" : " · " + cur)) : cur);
    }

    private void showQualityMenu() {
        if (qualities.size() > 1) {            // Emby/Jellyfin server levels
            final String[] items = new String[qualities.size() + 1];
            items[0] = "Auto (smooth, no pausing)";
            for (int i = 0; i < qualities.size(); i++) items[i + 1] = qualities.get(i).label + (i == 0 ? " (best picture)" : "");
            new AlertDialog.Builder(this).setTitle("Quality")
                    .setSingleChoiceItems(items, autoQuality ? 0 : qIndex + 1, (d, w) -> { d.dismiss();
                        if (w == 0) autoQuality = true; else { autoQuality = false; if (w - 1 != qIndex) switchTo(w - 1, null); }
                        updateQualityLabel(); hideSystemUi(); })
                    .show();
            return;
        }
        // Adaptive playlist variants
        final List<Tracks.Group> groups = new ArrayList<>(); final List<Integer> idx = new ArrayList<>(); final List<String> labels = new ArrayList<>();
        labels.add("Auto (smooth, no pausing)");
        for (Tracks.Group g : player.getCurrentTracks().getGroups()) if (g.getType() == C.TRACK_TYPE_VIDEO)
            for (int i = 0; i < g.length; i++) if (g.isTrackSupported(i)) { Format f = g.getTrackFormat(i);
                groups.add(g); idx.add(i);
                labels.add((f.height > 0 ? f.height + "p" : "Stream " + (i + 1)) + (f.bitrate > 0 ? String.format("  ·  %.1f Mbps", f.bitrate / 1e6) : "")); }
        new AlertDialog.Builder(this).setTitle("Quality")
                .setItems(labels.toArray(new String[0]), (d, w) -> {
                    if (w == 0) { autoQuality = true; capBitrate = Long.MAX_VALUE;
                        selector.setParameters(selector.buildUponParameters().clearOverridesOfType(C.TRACK_TYPE_VIDEO).setMaxVideoBitrate(Integer.MAX_VALUE)); }
                    else { autoQuality = false; Tracks.Group g = groups.get(w - 1);
                        selector.setParameters(selector.buildUponParameters().setMaxVideoBitrate(Integer.MAX_VALUE)
                                .setOverrideForType(new TrackSelectionOverride(g.getMediaTrackGroup(), idx.get(w - 1)))); }
                    updateQualityLabel(); hideSystemUi(); })
                .show();
    }

    // ---------------------------------------------------------------- UI

    private void buildUi(String title, String sub) {
        FrameLayout root = new FrameLayout(this);
        rootLayout = root;
        root.setBackgroundColor(Color.BLACK);
        view = new PlayerView(this);
        view.setShowSubtitleButton(true);
        view.setKeepContentOnPlayerReset(true);
        view.setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER);
        view.setControllerShowTimeoutMs(HIDE_MS);
        view.setControllerHideOnTouch(true);
        root.addView(view, new FrameLayout.LayoutParams(-1, -1));

        spinner = new ProgressBar(this);
        root.addView(spinner, new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.CENTER));
        errorText = new TextView(this);
        errorText.setTextColor(Color.WHITE); errorText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        errorText.setGravity(Gravity.CENTER); errorText.setPadding(dp(28), dp(22), dp(28), dp(22)); errorText.setVisibility(View.GONE);
        errorText.setLineSpacing(0, 1.2f);
        { GradientDrawable eb = new GradientDrawable(); eb.setColor(0xE60B1220); eb.setCornerRadius(dp(18)); eb.setStroke(dp(1), 0x5522DDE2); errorText.setBackground(eb); }
        { FrameLayout.LayoutParams elp = new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER); elp.setMargins(dp(40), 0, dp(40), 0); root.addView(errorText, elp); }

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL); bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(12), dp(14), dp(16), dp(24));
        bar.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[]{0xCC000000, 0x00000000}));
        bar.addView(pill("‹", 34, v -> finishWith("ok"), false), new LinearLayout.LayoutParams(dp(48), dp(48)));
        LinearLayout texts = new LinearLayout(this); texts.setOrientation(LinearLayout.VERTICAL);
        titleView = new TextView(this); titleView.setText(title == null ? "" : title); titleView.setTextColor(Color.WHITE);
        titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18); titleView.setTypeface(Typeface.DEFAULT_BOLD);
        titleView.setMaxLines(1); titleView.setEllipsize(android.text.TextUtils.TruncateAt.END);
        texts.addView(titleView);
        subView = new TextView(this); subView.setText(sub == null ? "" : sub); subView.setTextColor(0xFF22DDE2);
        subView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13); subView.setVisibility(sub == null || sub.isEmpty() ? View.GONE : View.VISIBLE);
        texts.addView(subView);
        bar.addView(texts, new LinearLayout.LayoutParams(0, -2, 1f));
        if (live && channels.size() > 1) {
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2); lp.setMargins(0, 0, dp(8), 0);
            bar.addView(pill("▲ Ch", 13, v -> zap(-1), true), lp);
            bar.addView(pill("Ch ▼", 13, v -> zap(1), true), lp);
        }
        qualityBtn = pill("Auto", 13, v -> showQualityMenu(), true);
        qualityBtn.setVisibility(View.GONE);
        // ★ Favourite: saved when the player closes, so it shows under Favourites in Movies / Series.
        favBtn = pill("\u2606 Favourite", 13, v -> toggleFav(), true);
        favBtn.setVisibility(meta != null && meta.optString("favKind").length() > 0 ? View.VISIBLE : View.GONE);
        favOn = meta != null && meta.optBoolean("fav", false); paintFav();
        LinearLayout.LayoutParams flp = new LinearLayout.LayoutParams(-2, -2); flp.rightMargin = dp(10);
        bar.addView(favBtn, flp);
        bar.addView(qualityBtn, new LinearLayout.LayoutParams(-2, -2));
        topBar = bar;
        root.addView(bar, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP));
        seekFlash = new TextView(this); seekFlash.setTextColor(Color.WHITE); seekFlash.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        seekFlash.setTypeface(Typeface.DEFAULT_BOLD); seekFlash.setPadding(dp(18), dp(12), dp(18), dp(12)); seekFlash.setAlpha(0f);
        GradientDrawable sb = new GradientDrawable(); sb.setColor(0x99000000); sb.setCornerRadius(dp(28)); seekFlash.setBackground(sb);
        root.addView(seekFlash, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER_VERTICAL | Gravity.START));
        // Info card shown while paused: poster, title, season / episode, and the plot.
        infoCard = new LinearLayout(this); infoCard.setOrientation(LinearLayout.HORIZONTAL); infoCard.setVisibility(View.GONE);
        infoCard.setPadding(dp(18), dp(16), dp(22), dp(16));
        { GradientDrawable ib = new GradientDrawable(); ib.setColor(0xE60B1220); ib.setCornerRadius(dp(18)); ib.setStroke(dp(1), 0x3322DDE2); infoCard.setBackground(ib); }
        infoPoster = new android.widget.ImageView(this); infoPoster.setScaleType(android.widget.ImageView.ScaleType.CENTER_CROP);
        { GradientDrawable pb = new GradientDrawable(); pb.setColor(0xFF151D27); pb.setCornerRadius(dp(10)); infoPoster.setBackground(pb); infoPoster.setClipToOutline(true); }
        LinearLayout.LayoutParams plp = new LinearLayout.LayoutParams(dp(96), dp(140)); plp.setMargins(0, 0, dp(18), 0); infoCard.addView(infoPoster, plp);
        LinearLayout itx = new LinearLayout(this); itx.setOrientation(LinearLayout.VERTICAL);
        infoKicker = new TextView(this); infoKicker.setTextColor(0xFF2FD4E8); infoKicker.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13); infoKicker.setTypeface(Typeface.DEFAULT_BOLD); infoKicker.setLetterSpacing(0.08f);
        infoTitle = new TextView(this); infoTitle.setTextColor(Color.WHITE); infoTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22); infoTitle.setTypeface(Typeface.DEFAULT_BOLD); infoTitle.setMaxLines(2); infoTitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
        infoEp = new TextView(this); infoEp.setTextColor(0xFFF2F5F8); infoEp.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15); infoEp.setPadding(0, dp(4), 0, 0); infoEp.setMaxLines(1); infoEp.setEllipsize(android.text.TextUtils.TruncateAt.END);
        infoPlot = new TextView(this); infoPlot.setTextColor(0xFFAAB4BF); infoPlot.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14); infoPlot.setPadding(0, dp(8), 0, 0); infoPlot.setMaxLines(4); infoPlot.setEllipsize(android.text.TextUtils.TruncateAt.END); infoPlot.setLineSpacing(0, 1.15f);
        itx.addView(infoKicker); itx.addView(infoTitle); itx.addView(infoEp); itx.addView(infoPlot);
        infoCard.addView(itx, new LinearLayout.LayoutParams(0, -2, 1f));
        { FrameLayout.LayoutParams ilp = new FrameLayout.LayoutParams(-1, -2, Gravity.TOP | Gravity.START); ilp.setMargins(dp(32), dp(86), dp(32), 0);
          android.util.DisplayMetrics dmm = getResources().getDisplayMetrics(); ilp.width = Math.min(dmm.widthPixels - dp(64), dp(760)); root.addView(infoCard, ilp); }
        setContentView(root);
        addControlButtons();
        view.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener) visibility -> {
            topBar.setVisibility(visibility); if (visibility != View.VISIBLE) hideSystemUi(); else armAutoHide(); updateInfoCard(); });
    }

    // ---- Extra controls inside the player bar (reachable with the remote) + a clear focus highlight ----
    private LinearLayout infoCard; private android.widget.ImageView infoPoster; private TextView infoKicker, infoTitle, infoEp, infoPlot;
    private String posterLoadedFor = null;
    private TextView displayBtn;
    private static final int[] RESIZE = { androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_FIT, androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_ZOOM, androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_FILL };
    private static final String[] RESIZE_LABEL = { "Fit", "Fill screen", "Stretch" };
    private int resizeIdx = 0;
    private void addControlButtons() {
        try { resizeIdx = getSharedPreferences("byo_player", MODE_PRIVATE).getInt("resize", 0); if (resizeIdx < 0 || resizeIdx >= RESIZE.length) resizeIdx = 0; } catch (Exception ignored) {}
        view.setResizeMode(RESIZE[resizeIdx]);
        LinearLayout basic = view.findViewById(androidx.media3.ui.R.id.exo_basic_controls);
        if (basic != null) {
            String type = meta.optString("type", "");
            if (!live && ("episode".equals(type) || "movie".equals(type))) {
                boolean isEpisode = "episode".equals(type);
                // Icon only, same square size as the other player buttons (language/display/subtitle/settings/fullscreen)
                // so the row reads as one consistent set of controls instead of a wide text pill breaking the rhythm.
                TextView pick = ctrlPill("\u2630", v -> { if (isEpisode) { if (allEps != null) showEpisodes(); else finishWith("browse"); } else finishWith("browse"); });
                pick.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22); pick.setPadding(0, 0, 0, 0);
                pick.setContentDescription(isEpisode ? "Episodes" : "More movies");
                LinearLayout.LayoutParams plp = new LinearLayout.LayoutParams(dp(52), dp(52)); plp.setMargins(dp(4), 0, dp(4), 0); plp.gravity = Gravity.CENTER_VERTICAL;
                basic.addView(pick, 0, plp);
            }
            // Audio language: globe icon; lists the languages this stream carries.
            android.widget.ImageButton langBtn = new android.widget.ImageButton(this);
            langBtn.setImageResource(R.drawable.ic_language); langBtn.setScaleType(android.widget.ImageView.ScaleType.FIT_CENTER);
            langBtn.setBackgroundColor(0); langBtn.setFocusable(true); langBtn.setContentDescription("Audio language");
            langBtn.setOnClickListener(v -> showAudioLanguages());
            LinearLayout.LayoutParams llp = new LinearLayout.LayoutParams(dp(52), dp(52)); llp.setMargins(dp(4), 0, dp(4), 0); llp.gravity = Gravity.CENTER_VERTICAL;
            basic.addView(langBtn, (!live && ("episode".equals(type) || "movie".equals(type))) ? 1 : 0, llp);
            // Icon only (no "Fit" text), same round size as the other player buttons; the mode name shows when pressed.
            displayBtn = ctrlPill("\u26F6", v -> cycleResize());
            displayBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22); displayBtn.setPadding(0, 0, 0, 0);
            displayBtn.setContentDescription("Display: " + RESIZE_LABEL[resizeIdx]);
            LinearLayout.LayoutParams dlp = new LinearLayout.LayoutParams(dp(52), dp(52)); dlp.setMargins(dp(4), 0, dp(4), 0); dlp.gravity = Gravity.CENTER_VERTICAL;
            basic.addView(displayBtn, dlp);
        }
        highlightFocus(view);
    }
    private TextView ctrlPill(String text, View.OnClickListener l) {
        TextView t = new TextView(this); t.setText(text); t.setTextColor(Color.WHITE); t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14); t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setGravity(Gravity.CENTER); t.setPadding(dp(18), 0, dp(18), 0); t.setFocusable(true); t.setClickable(true); t.setOnClickListener(l); return t; }
    private void cycleResize() {
        resizeIdx = (resizeIdx + 1) % RESIZE.length; view.setResizeMode(RESIZE[resizeIdx]);
        if (displayBtn != null) displayBtn.setContentDescription("Display: " + RESIZE_LABEL[resizeIdx]);
        try { getSharedPreferences("byo_player", MODE_PRIVATE).edit().putInt("resize", resizeIdx).apply(); } catch (Exception ignored) {}
        Toast.makeText(this, "Display: " + RESIZE_LABEL[resizeIdx], Toast.LENGTH_SHORT).show(); armAutoHide();
    }
    // Every button in the player gets a bright cyan ring and a slight zoom when the remote is on it.
    private void highlightFocus(View v) {
        if (v instanceof android.view.ViewGroup) { android.view.ViewGroup g = (android.view.ViewGroup) v; for (int i = 0; i < g.getChildCount(); i++) highlightFocus(g.getChildAt(i)); }
        if (v == view || !v.isFocusable() || v instanceof android.view.SurfaceView || v instanceof android.view.TextureView) return;
        if (v instanceof androidx.media3.ui.DefaultTimeBar) return;
        android.graphics.drawable.StateListDrawable sl = new android.graphics.drawable.StateListDrawable();
        // Pill/circle ring drawn a few dp INSIDE the button's own bounds, so nothing around it can cut it off.
        GradientDrawable on = new GradientDrawable(); on.setColor(0x552FD4E8); on.setStroke(dp(3), 0xFF2FD4E8); on.setCornerRadius(dp(999));
        GradientDrawable off = new GradientDrawable(); off.setColor(v instanceof TextView && v != displayBtn ? 0x33FFFFFF : 0x00000000); off.setCornerRadius(dp(999));
        int ins = dp(3);
        sl.addState(new int[]{ android.R.attr.state_focused }, new android.graphics.drawable.InsetDrawable(on, ins)); sl.addState(new int[]{}, new android.graphics.drawable.InsetDrawable(off, ins));
        v.setBackground(sl); v.setClipToOutline(false); v.setOutlineProvider(null); v.setScaleX(1f); v.setScaleY(1f);
        // round icon buttons: keep them square so the ring is a clean circle
        if (v instanceof android.widget.ImageButton) { int pd = dp(10); v.setPadding(pd, pd, pd, pd); }
        final View.OnFocusChangeListener prev = v.getOnFocusChangeListener();
        // No zoom: a zoomed button spills past the control bar and gets cut off top and bottom.
        // The ring is drawn inside the button's own bounds, and parents are told not to clip.
        for (android.view.ViewParent pp = v.getParent(); pp instanceof android.view.ViewGroup; pp = pp.getParent()) { ((android.view.ViewGroup) pp).setClipChildren(false); ((android.view.ViewGroup) pp).setClipToPadding(false); }
        v.setOnFocusChangeListener((vv, has) -> { if (prev != null) prev.onFocusChange(vv, has); if (has) armAutoHide(); });
    }
    private void updateInfoCard() {
        if (infoCard == null) return;
        boolean paused = player != null && !player.getPlayWhenReady() && everPlayed;
        boolean show = paused && !live && view != null && view.isControllerFullyVisible() && (meta.length() > 0);
        if (!show) { infoCard.setVisibility(View.GONE); return; }
        String type = meta.optString("type", "");
        infoKicker.setText("episode".equals(type) ? "NOW PLAYING \u00B7 SERIES" : "NOW PLAYING \u00B7 MOVIE");
        String head = meta.optString("series", ""); if (head.isEmpty()) head = titleView != null ? titleView.getText().toString() : "";
        infoTitle.setText(head);
        String ep = meta.optString("epLabel", ""); if (ep.isEmpty() && "movie".equals(type)) { String y = meta.optString("year", ""), gn = meta.optString("genre", ""); ep = (y + (y.length() > 0 && gn.length() > 0 ? "  \u00B7  " : "") + gn); }
        infoEp.setText(ep); infoEp.setVisibility(ep.isEmpty() ? View.GONE : View.VISIBLE);
        String plot = meta.optString("plot", ""); infoPlot.setText(plot); infoPlot.setVisibility(plot.isEmpty() ? View.GONE : View.VISIBLE);
        final String pu = meta.optString("poster", "");
        if (pu.startsWith("http") && !pu.equals(posterLoadedFor)) { posterLoadedFor = pu; infoPoster.setImageDrawable(null);
            new Thread(() -> { try { java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(pu).openConnection(); c.setConnectTimeout(8000); c.setReadTimeout(10000); c.setInstanceFollowRedirects(true);
                android.graphics.BitmapFactory.Options o = new android.graphics.BitmapFactory.Options(); o.inSampleSize = 2;
                final Bitmap bm = android.graphics.BitmapFactory.decodeStream(c.getInputStream(), null, o); c.disconnect();
                if (bm != null) h.post(() -> { if (pu.equals(posterLoadedFor) && infoPoster != null) infoPoster.setImageBitmap(bm); }); } catch (Exception ignored) {} }).start(); }
        infoPoster.setVisibility(pu.startsWith("http") ? View.VISIBLE : View.GONE);
        infoCard.setVisibility(View.VISIBLE);
    }

    // ---- Score alerts from the app (followed matches): a card in the top-right corner.
    //      OK on the remote switches to the match channel; BACK or a few seconds hides it.
    private static java.lang.ref.WeakReference<PlayerActivity> currentRef;
    public static PlayerActivity current() { return currentRef == null ? null : currentRef.get(); }
    private FrameLayout rootLayout;
    private LinearLayout alertBox;
    private String alertUrl, alertTitle;
    private final Runnable hideAlert = () -> { if (alertBox != null) alertBox.animate().alpha(0f).translationX(dp(40)).setDuration(220).withEndAction(() -> { if (alertBox != null) alertBox.setVisibility(View.GONE); }).start(); alertUrl = null; };
    private boolean alertShowing() { return alertBox != null && alertBox.getVisibility() == View.VISIBLE && alertUrl != null; }

    public void showAlert(String msg, String chName, String url) {
        if (rootLayout == null || isFinishing()) return;
        if (alertBox == null) {
            alertBox = new LinearLayout(this); alertBox.setOrientation(LinearLayout.VERTICAL);
            alertBox.setPadding(dp(18), dp(14), dp(18), dp(14));
            GradientDrawable bg = new GradientDrawable(); bg.setColor(0xEE0B1220); bg.setCornerRadius(dp(16)); bg.setStroke(dp(2), 0xFF22DDE2);
            alertBox.setBackground(bg); alertBox.setElevation(dp(12));
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(dp(360), -2, Gravity.TOP | Gravity.END);
            lp.setMargins(0, dp(24), dp(24), 0);
            rootLayout.addView(alertBox, lp);
        }
        alertBox.removeAllViews();
        TextView t = new TextView(this); t.setTextColor(Color.WHITE); t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16); t.setTypeface(Typeface.DEFAULT_BOLD); t.setText(msg);
        alertBox.addView(t);
        boolean canWatch = url != null && url.startsWith("http");
        if (canWatch) {
            TextView w = new TextView(this); w.setTextColor(0xFF22DDE2); w.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14); w.setTypeface(Typeface.DEFAULT_BOLD);
            w.setText("Press OK to watch" + (chName != null && !chName.isEmpty() ? " on " + chName : "")); w.setPadding(0, dp(8), 0, 0);
            alertBox.addView(w);
            alertBox.setOnClickListener(v -> watchAlert());
        } else alertBox.setOnClickListener(v -> h.post(hideAlert));
        alertUrl = canWatch ? url : ""; alertTitle = chName;
        alertBox.setVisibility(View.VISIBLE); alertBox.setAlpha(0f); alertBox.setTranslationX(dp(40));
        alertBox.animate().alpha(1f).translationX(0).setDuration(220).start();
        h.removeCallbacks(hideAlert); h.postDelayed(hideAlert, 12000);
    }

    // ---- Series auto-play: when an episode ends, count down and roll on to the next one.
    //      OK plays it now, BACK stops (returns to the app).
    private LinearLayout upNextBox;
    private TextView upNextCount;
    private int upNextSecs = 0;
    private final Runnable upNextTick = new Runnable() { public void run() {
        if (upNextBox == null || upNextBox.getVisibility() != View.VISIBLE) return;
        upNextSecs--;
        if (upNextSecs <= 0) { playNextEpisode(); return; }
        upNextCount.setText("Playing in " + upNextSecs + "s  ·  OK to play now  ·  BACK to stop");
        h.postDelayed(this, 1000);
    } };
    private boolean upNextShowing() { return upNextBox != null && upNextBox.getVisibility() == View.VISIBLE; }
    private void showUpNext() {
        if (rootLayout == null || isFinishing() || finishing) return;
        Ep n = nextEps.get(epAdvanced);
        if (upNextBox == null) {
            upNextBox = new LinearLayout(this); upNextBox.setOrientation(LinearLayout.VERTICAL);
            upNextBox.setPadding(dp(22), dp(16), dp(22), dp(16));
            GradientDrawable bg = new GradientDrawable(); bg.setColor(0xEE0B1220); bg.setCornerRadius(dp(16)); bg.setStroke(dp(2), 0xFF22DDE2);
            upNextBox.setBackground(bg); upNextBox.setElevation(dp(12));
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(dp(440), -2, Gravity.BOTTOM | Gravity.END);
            lp.setMargins(0, 0, dp(32), dp(40));
            rootLayout.addView(upNextBox, lp);
            upNextBox.setOnClickListener(v -> playNextEpisode());
        }
        upNextBox.removeAllViews();
        TextView lab = new TextView(this); lab.setTextColor(0xFF22DDE2); lab.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13); lab.setTypeface(Typeface.DEFAULT_BOLD); lab.setText("UP NEXT");
        TextView t = new TextView(this); t.setTextColor(Color.WHITE); t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18); t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setText(n.sub == null || n.sub.isEmpty() ? n.title : n.sub); t.setPadding(0, dp(4), 0, 0);
        TextView st = new TextView(this); st.setTextColor(0xCCFFFFFF); st.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14); st.setText(n.title == null ? "" : n.title);
        upNextCount = new TextView(this); upNextCount.setTextColor(0xCCFFFFFF); upNextCount.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14); upNextCount.setPadding(0, dp(10), 0, 0);
        upNextBox.addView(lab); upNextBox.addView(t); upNextBox.addView(st); upNextBox.addView(upNextCount);
        upNextSecs = 10; upNextCount.setText("Playing in 10s  ·  OK to play now  ·  BACK to stop");
        upNextBox.setVisibility(View.VISIBLE); upNextBox.setAlpha(0f); upNextBox.animate().alpha(1f).setDuration(220).start();
        if (view != null) view.hideController();
        h.removeCallbacks(upNextTick); h.postDelayed(upNextTick, 1000);
    }
    private void hideUpNext() { h.removeCallbacks(upNextTick); if (upNextBox != null) upNextBox.setVisibility(View.GONE); }
    private void playNextEpisode() {
        if (epAdvanced >= nextEps.size() || player == null || finishing) return;
        hideUpNext();
        Ep n = nextEps.get(epAdvanced); epAdvanced++;
        try { if (epAdvanced - 1 < nextMeta.size()) { meta = nextMeta.get(epAdvanced - 1); posterLoadedFor = null; } } catch (Exception ignored) {}
        if (titleView != null) titleView.setText(n.title == null ? "" : n.title);
        if (subView != null) subView.setText(n.sub == null ? "" : n.sub);
        qualities.clear(); qualities.add(new Q("Original", n.url, Long.MAX_VALUE)); qIndex = 0;
        everPlayed = false; retries = 0; rebuffers.clear(); bufferingSince = 0;
        errorText.setVisibility(View.GONE);
        load(n.url, n.startMs);
    }

    private void watchAlert() {
        String url = alertUrl, name = alertTitle; h.removeCallbacks(hideAlert); hideAlert.run();
        if (url == null || url.isEmpty()) return;
        int idx = -1; for (int i = 0; i < channels.size(); i++) if (url.equals(channels.get(i).url)) { idx = i; break; }
        if (idx < 0) { channels.add(new Ch(name == null ? "Live" : name, "", url, null, null)); idx = channels.size() - 1; }
        live = true; switchTo(idx);
    }

    // ---- Controls fade away after a few seconds of playback, even on TVs where the
    //      built-in timer never fires (some TVs run accessibility services that keep it open).
    private static final int HIDE_MS = 4000;
    private final Runnable autoHide = new Runnable() { @Override public void run() {
        if (view == null) return;
        if (player != null && player.isPlaying() && view.isControllerFullyVisible()) view.hideController();
        else if (view.isControllerFullyVisible()) h.postDelayed(this, HIDE_MS);
    } };
    private void armAutoHide() { h.removeCallbacks(autoHide); h.postDelayed(autoHide, HIDE_MS); }

    // ---- Audio language picker ----
    private static String langName(Format f, int n) {
        String lang = f.language; String name = null;
        if (lang != null && lang.length() > 0 && !"und".equals(lang)) { try { String d = new java.util.Locale(lang).getDisplayLanguage(java.util.Locale.ENGLISH); if (d != null && d.length() > 0 && !d.equalsIgnoreCase(lang)) name = d; } catch (Exception ignored) {} if (name == null) name = lang.toUpperCase(java.util.Locale.ROOT); }
        if (f.label != null && f.label.trim().length() > 0 && (name == null || !f.label.toLowerCase(java.util.Locale.ROOT).contains(name.toLowerCase(java.util.Locale.ROOT)))) name = name == null ? f.label.trim() : name + " \u00B7 " + f.label.trim();
        if (name == null) name = "Audio " + n;
        if (f.channelCount >= 6) name += "  (5.1)"; else if (f.channelCount == 2) name += "  (Stereo)";
        return name;
    }
    private void showAudioLanguages() {
        if (player == null || rootLayout == null || finishing) return;
        final List<Tracks.Group> groups = new ArrayList<>(); final List<Integer> idx = new ArrayList<>(); final List<String> labels = new ArrayList<>(); int sel = -1;
        for (Tracks.Group g : player.getCurrentTracks().getGroups()) {
            if (g.getType() != C.TRACK_TYPE_AUDIO) continue;
            for (int i = 0; i < g.length; i++) { if (!g.isTrackSupported(i)) continue;
                groups.add(g); idx.add(i); labels.add(langName(g.getTrackFormat(i), labels.size() + 1)); if (g.isTrackSelected(i)) sel = labels.size() - 1; }
        }
        if (labels.size() <= 1) { Toast.makeText(this, labels.isEmpty() ? "No audio tracks found yet" : "This only comes in one language: " + labels.get(0), Toast.LENGTH_LONG).show(); armAutoHide(); return; }
        hideEpisodes(); if (view != null) view.hideController();
        epPanel = new FrameLayout(this); epPanel.setBackgroundColor(0x99000000); epPanel.setClickable(true); epPanel.setOnClickListener(v -> hideEpisodes());
        LinearLayout box = new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL); box.setClickable(true);
        GradientDrawable bg = new GradientDrawable(); bg.setColor(0xF2101521); bg.setCornerRadius(dp(18)); box.setBackground(bg); box.setPadding(dp(22), dp(20), dp(22), dp(16));
        TextView head = new TextView(this); head.setText("Audio language"); head.setTextColor(Color.WHITE); head.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20); head.setTypeface(Typeface.DEFAULT_BOLD); head.setPadding(dp(6), 0, 0, dp(10)); box.addView(head);
        android.widget.ScrollView sc = new android.widget.ScrollView(this); LinearLayout list = new LinearLayout(this); list.setOrientation(LinearLayout.VERTICAL); sc.addView(list);
        View focusMe = null;
        for (int k = 0; k < labels.size(); k++) {
            final int kk = k; boolean on = k == sel;
            TextView row = new TextView(this); row.setText((on ? "\u2713  " : "     ") + labels.get(k)); row.setTextColor(on ? 0xFF2FD4E8 : Color.WHITE); row.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
            row.setTypeface(on ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT); row.setFocusable(true); row.setClickable(true); row.setPadding(dp(14), dp(12), dp(14), dp(12));
            android.graphics.drawable.StateListDrawable sl = new android.graphics.drawable.StateListDrawable();
            GradientDrawable fo = new GradientDrawable(); fo.setColor(0x552FD4E8); fo.setStroke(dp(2), 0xFF2FD4E8); fo.setCornerRadius(dp(12));
            GradientDrawable no = new GradientDrawable(); no.setColor(0); no.setCornerRadius(dp(12));
            sl.addState(new int[]{ android.R.attr.state_focused }, fo); sl.addState(new int[]{}, no); row.setBackground(sl);
            row.setOnClickListener(v -> {
                try { Tracks.Group g = groups.get(kk); int ti = idx.get(kk);
                    selector.setParameters(selector.buildUponParameters().setOverrideForType(new TrackSelectionOverride(g.getMediaTrackGroup(), ti)));
                    String lang = g.getTrackFormat(ti).language;
                    if (lang != null && lang.length() > 0 && !"und".equals(lang)) getSharedPreferences("byo_player", MODE_PRIVATE).edit().putString("audioLang", lang).apply();
                    Toast.makeText(this, "Audio: " + labels.get(kk), Toast.LENGTH_SHORT).show();
                } catch (Exception ignored) {}
                hideEpisodes(); });
            list.addView(row, new LinearLayout.LayoutParams(-1, -2));
            if (on || focusMe == null) focusMe = row;
        }
        box.addView(sc, new LinearLayout.LayoutParams(-1, -2));
        TextView hint = new TextView(this); hint.setText("OK to choose  \u00B7  BACK to close"); hint.setTextColor(0xFF8C97AB); hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12); hint.setPadding(dp(6), dp(10), 0, 0); box.addView(hint);
        android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
        FrameLayout.LayoutParams blp = new FrameLayout.LayoutParams(Math.min(dm.widthPixels - dp(32), dp(420)), -2, Gravity.CENTER);
        epPanel.addView(box, blp); rootLayout.addView(epPanel, new FrameLayout.LayoutParams(-1, -1));
        final View f = focusMe; epPanel.post(() -> { if (f != null) f.requestFocus(); });
    }

    // ---- Episode list inside the player ----
    private JSONArray allEps = null; private int curEp = -1, pickIdx = -1;
    private FrameLayout epPanel = null;
    private boolean epPanelShowing() { return epPanel != null && epPanel.getVisibility() == View.VISIBLE; }
    private void hideEpisodes() { if (epPanel != null) { rootLayout.removeView(epPanel); epPanel = null; } }
    private void showEpisodes() {
        if (allEps == null || rootLayout == null || finishing) return;
        hideEpisodes(); if (view != null) view.hideController();
        final int now = Math.min(allEps.length() - 1, curEp + epAdvanced);
        epPanel = new FrameLayout(this); epPanel.setBackgroundColor(0x99000000); epPanel.setClickable(true);
        epPanel.setOnClickListener(v -> hideEpisodes());
        LinearLayout side = new LinearLayout(this); side.setOrientation(LinearLayout.VERTICAL); side.setClickable(true);
        GradientDrawable bg = new GradientDrawable(); bg.setColor(0xF2101521); side.setBackground(bg); side.setPadding(dp(22), dp(22), dp(22), dp(16));
        TextView head = new TextView(this); head.setText("Episodes"); head.setTextColor(Color.WHITE); head.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22); head.setTypeface(Typeface.DEFAULT_BOLD);
        side.addView(head);
        String series = meta.optString("series", ""); if (series.length() > 0) { TextView sv = new TextView(this); sv.setText(series); sv.setTextColor(0xFFA9B4C8); sv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14); sv.setPadding(0, dp(2), 0, dp(12)); side.addView(sv); }
        android.widget.ScrollView sc = new android.widget.ScrollView(this); sc.setFillViewport(false); sc.setVerticalScrollBarEnabled(false);
        LinearLayout list = new LinearLayout(this); list.setOrientation(LinearLayout.VERTICAL); sc.addView(list);
        View focusMe = null; String lastSeason = null;
        for (int i = 0; i < allEps.length(); i++) {
            JSONObject o = allEps.optJSONObject(i); if (o == null) continue;
            String sn = o.optString("s", "");
            if (!sn.equals(lastSeason)) { lastSeason = sn; TextView sh = new TextView(this); sh.setText(sn.length() > 0 ? "SEASON " + sn : "EPISODES");
                sh.setTextColor(0xFF2FD4E8); sh.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12); sh.setTypeface(Typeface.DEFAULT_BOLD); sh.setLetterSpacing(0.12f); sh.setPadding(dp(6), dp(14), 0, dp(6)); list.addView(sh); }
            final int idx = i; boolean isNow = i == now; double w = o.optDouble("w", 0);
            LinearLayout row = new LinearLayout(this); row.setOrientation(LinearLayout.VERTICAL); row.setFocusable(true); row.setClickable(true); row.setPadding(dp(14), dp(10), dp(14), dp(10));
            android.graphics.drawable.StateListDrawable sl = new android.graphics.drawable.StateListDrawable();
            GradientDrawable fo = new GradientDrawable(); fo.setColor(0x552FD4E8); fo.setStroke(dp(2), 0xFF2FD4E8); fo.setCornerRadius(dp(12));
            GradientDrawable no = new GradientDrawable(); no.setColor(isNow ? 0x332FD4E8 : 0x00000000); no.setCornerRadius(dp(12));
            sl.addState(new int[]{ android.R.attr.state_focused }, fo); sl.addState(new int[]{}, no); row.setBackground(sl);
            TextView t1 = new TextView(this); String tt = o.optString("t", "");
            t1.setText("E" + o.optString("n", String.valueOf(i + 1)) + (tt.length() > 0 ? "  \u00B7  " + tt : "")); t1.setTextColor(Color.WHITE); t1.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
            t1.setTypeface(isNow ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT); t1.setMaxLines(1); t1.setEllipsize(android.text.TextUtils.TruncateAt.END); row.addView(t1);
            String st = isNow ? "\u25B6 Now playing" : (w >= 1 ? "\u2713 Watched" : (w > 0 ? Math.round(w * 100) + "% watched" : ""));
            if (st.length() > 0) { TextView t2 = new TextView(this); t2.setText(st); t2.setTextColor(isNow ? 0xFF2FD4E8 : 0xFF8C97AB); t2.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12); t2.setPadding(0, dp(2), 0, 0); row.addView(t2); }
            row.setOnClickListener(v -> { if (idx == now) { hideEpisodes(); return; } pickIdx = idx; hideEpisodes(); finishWith("pickEp"); });
            LinearLayout.LayoutParams rlp = new LinearLayout.LayoutParams(-1, -2); rlp.setMargins(0, dp(2), 0, dp(2)); list.addView(row, rlp);
            if (isNow) focusMe = row;
        }
        side.addView(sc, new LinearLayout.LayoutParams(-1, 0, 1f));
        TextView hint = new TextView(this); hint.setText("OK to play  \u00B7  BACK to keep watching"); hint.setTextColor(0xFF8C97AB); hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12); hint.setPadding(dp(6), dp(10), 0, 0); side.addView(hint);
        android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
        int pw = Math.min(dm.widthPixels, Math.max(dp(300), Math.min(dp(460), Math.round(dm.widthPixels * 0.42f))));
        epPanel.addView(side, new FrameLayout.LayoutParams(pw, -1, Gravity.END));
        rootLayout.addView(epPanel, new FrameLayout.LayoutParams(-1, -1));
        final View f = focusMe; final android.widget.ScrollView fsc = sc;
        epPanel.post(() -> { if (f != null) { f.requestFocus(); fsc.scrollTo(0, Math.max(0, f.getTop() - dp(120))); } else if (list.getChildCount() > 1) list.getChildAt(1).requestFocus(); });
    }

    @Override public boolean dispatchKeyEvent(KeyEvent e) {
        int kc = e.getKeyCode();
        if (epPanelShowing()) {
            if (kc == KeyEvent.KEYCODE_BACK || kc == KeyEvent.KEYCODE_ESCAPE) { if (e.getAction() == KeyEvent.ACTION_UP) hideEpisodes(); return true; }
            if (kc == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE && e.getAction() == KeyEvent.ACTION_UP && player != null) { player.setPlayWhenReady(!player.getPlayWhenReady()); return true; }
            return super.dispatchKeyEvent(e);
        }
        if (upNextShowing()) {
            if (e.getAction() == KeyEvent.ACTION_UP) {
                if (kc == KeyEvent.KEYCODE_BACK) { hideUpNext(); finishWith("ended"); }
                else if (kc == KeyEvent.KEYCODE_DPAD_CENTER || kc == KeyEvent.KEYCODE_ENTER || kc == KeyEvent.KEYCODE_MEDIA_NEXT
                        || kc == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || kc == KeyEvent.KEYCODE_MEDIA_PLAY) playNextEpisode();
            }
            return true;
        }
        if (kc == KeyEvent.KEYCODE_MEDIA_NEXT && !live && epAdvanced < nextEps.size()) { if (e.getAction() == KeyEvent.ACTION_UP) playNextEpisode(); return true; }
        if (unavailableShown) {
            boolean up = kc == KeyEvent.KEYCODE_DPAD_UP || kc == KeyEvent.KEYCODE_CHANNEL_UP, down = kc == KeyEvent.KEYCODE_DPAD_DOWN || kc == KeyEvent.KEYCODE_CHANNEL_DOWN;
            if (live && channels.size() > 1 && (up || down)) { if (e.getAction() == KeyEvent.ACTION_DOWN) zap(up ? -1 : 1); return true; }
            if (kc == KeyEvent.KEYCODE_DPAD_CENTER || kc == KeyEvent.KEYCODE_ENTER) {
                if (e.getAction() == KeyEvent.ACTION_UP) { retries = 0; everPlayed = false; spinner.setVisibility(View.VISIBLE);
                    load(live && !channels.isEmpty() ? channels.get(chIndex).url : qualities.get(qIndex).url, 0); }
                return true; }
        }
        if (alertShowing() && (kc == KeyEvent.KEYCODE_DPAD_CENTER || kc == KeyEvent.KEYCODE_ENTER || kc == KeyEvent.KEYCODE_BACK)) {
            if (e.getAction() == KeyEvent.ACTION_UP) {
                if (kc == KeyEvent.KEYCODE_BACK) { h.removeCallbacks(hideAlert); hideAlert.run(); }
                else if (!alertUrl.isEmpty()) watchAlert(); else hideAlert.run();
            }
            return true;
        }
        boolean r = super.dispatchKeyEvent(e);
        if (e.getAction() == KeyEvent.ACTION_DOWN && view != null && view.isControllerFullyVisible()) armAutoHide();
        return r;
    }


    // ---- Tap left / right side of the screen = rewind / forward 10 s (movies & episodes) ----
    private TextView seekFlash;
    private boolean sideGesture = false; private float downX, downY; private long downT;
    private int seekAccum = 0; private long lastSideTap = 0; private int lastSide = 0;
    private final Runnable hideFlash = () -> { if (seekFlash != null) seekFlash.animate().alpha(0f).setDuration(200).start(); seekAccum = 0; };

    private int sideOf(float x, float y) {
        View r = getWindow().getDecorView(); int w = r.getWidth(), hgt = r.getHeight(); if (w <= 0 || hgt <= 0) return 0;
        if (y < hgt * 0.16f || y > hgt * 0.80f) return 0;            // keep the top bar and the timeline / bottom buttons working
        if (x < w * 0.30f) return -1; if (x > w * 0.70f) return 1; return 0;
    }

    // Press and HOLD a side to scrub: the longer the finger stays down, the further it goes (released = one seek).
    private boolean holding = false; private int holdSide = 0; private long holdStart = 0; private double holdSecs = 0;
    private final Runnable holdTick = new Runnable() { public void run() {
        if (!sideGesture || player == null) return;
        holding = true;
        double held = (System.currentTimeMillis() - holdStart) / 1000.0;
        double rate = held < 2.5 ? 20 : (held < 5 ? 60 : 180);           // seconds of video per second held
        holdSecs += rate * 0.1;
        long cur = player.getCurrentPosition(), dur = player.getDuration();
        double maxBack = cur / 1000.0, maxFwd = (dur != C.TIME_UNSET && dur > 0) ? Math.max(0, (dur - cur - 1000) / 1000.0) : 36000;
        if (holdSide < 0 && holdSecs > maxBack) holdSecs = maxBack;
        if (holdSide > 0 && holdSecs > maxFwd) holdSecs = maxFwd;
        showFlash(holdSide, (long) holdSecs, true);
        h.postDelayed(this, 100);
    } };

    private String fmtSecs(long s) { long m = s / 60, r = s % 60; if (m >= 60) return (m / 60) + ":" + String.format("%02d:%02d", m % 60, r); return m > 0 ? (m + ":" + String.format("%02d", r)) : (s + "s"); }

    private void showFlash(int side, long secs, boolean hold) {
        if (seekFlash == null) return;
        String amt = fmtSecs(secs);
        seekFlash.setText(side < 0 ? ("\u23EA  " + (hold ? "-" : "") + amt) : ((hold ? "+" : "") + amt + "  \u23E9"));
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) seekFlash.getLayoutParams();
        lp.gravity = Gravity.CENTER_VERTICAL | (side < 0 ? Gravity.START : Gravity.END); lp.setMargins(dp(40), 0, dp(40), 0); seekFlash.setLayoutParams(lp);
        seekFlash.animate().cancel(); seekFlash.setAlpha(1f); seekFlash.setVisibility(View.VISIBLE);
        h.removeCallbacks(hideFlash); if (!hold) h.postDelayed(hideFlash, 700);
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent e) {
        if (view != null && view.isControllerFullyVisible()) armAutoHide();
        if (live || player == null) return super.dispatchTouchEvent(e);
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                holdSide = sideOf(e.getX(), e.getY()); sideGesture = holdSide != 0;
                downX = e.getX(); downY = e.getY(); downT = System.currentTimeMillis();
                if (sideGesture) { holding = false; holdSecs = 0; holdStart = downT + 450; h.removeCallbacks(holdTick); h.postDelayed(holdTick, 450); return true; }
                break;
            case MotionEvent.ACTION_MOVE:
                if (sideGesture) return true;
                break;
            case MotionEvent.ACTION_UP:
                if (sideGesture) { sideGesture = false; h.removeCallbacks(holdTick);
                    if (holding) { holding = false;
                        long pos = player.getCurrentPosition() + (long) (holdSide * holdSecs * 1000), dur = player.getDuration();
                        if (pos < 0) pos = 0; if (dur != C.TIME_UNSET && dur > 0 && pos > dur - 1000) pos = dur - 1000;
                        player.seekTo(pos); lastSeekAt = System.currentTimeMillis(); h.removeCallbacks(hideFlash); h.postDelayed(hideFlash, 600);
                    } else {
                        boolean tap = Math.abs(e.getX() - downX) < dp(24) && Math.abs(e.getY() - downY) < dp(24);
                        if (tap) sideSeek(holdSide);
                    }
                    return true; }
                break;
            case MotionEvent.ACTION_CANCEL:
                if (sideGesture) { sideGesture = false; holding = false; h.removeCallbacks(holdTick); h.postDelayed(hideFlash, 200); return true; }
                break;
        }
        return super.dispatchTouchEvent(e);
    }

    private void sideSeek(int side) {
        if (side == 0 || player == null) return;
        long now = System.currentTimeMillis();
        if (side != lastSide || now - lastSideTap > 1200) seekAccum = 0;
        lastSide = side; lastSideTap = now; seekAccum += 10;
        long dur = player.getDuration(); long pos = player.getCurrentPosition() + side * 10000L;
        if (pos < 0) pos = 0; if (dur != C.TIME_UNSET && dur > 0 && pos > dur - 1000) pos = dur - 1000;
        player.seekTo(pos); lastSeekAt = now;
        showFlash(side, seekAccum, false);
    }

    private TextView pill(String text, int sp, View.OnClickListener l, boolean boxed) {
        TextView t = new TextView(this);
        t.setText(text); t.setTextColor(Color.WHITE); t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTypeface(Typeface.DEFAULT_BOLD); t.setGravity(Gravity.CENTER);
        if (boxed) { t.setPadding(dp(12), dp(7), dp(12), dp(7)); GradientDrawable b = new GradientDrawable(); b.setColor(0x33FFFFFF); b.setCornerRadius(dp(16)); t.setBackground(b); }
        else t.setPadding(dp(8), 0, dp(14), dp(4));
        t.setOnClickListener(l);
        return t;
    }

    // ---------------------------------------------------------------- lifecycle

    private String lastErr = "";
    private void paintFav() { if (favBtn == null) return; favBtn.setText(favOn ? "\u2605 In favourites" : "\u2606 Add to favourites"); favBtn.setTextColor(favOn ? 0xFFF5C451 : Color.WHITE); }
    private void toggleFav() { favOn = !favOn; favChanged = true; paintFav();
        boolean ep = meta != null && "series".equals(meta.optString("favKind"));
        Toast.makeText(this, favOn ? (ep ? "Series added to favourites" : "Added to favourites") : "Removed from favourites", Toast.LENGTH_SHORT).show(); }

    private void finishWith(String status) {
        if (finishing) return;
        if ("error".equals(status) && lastErr.length() > 0) { try { MainActivity.noteIssue(this, "TV player could not open " + (titleView != null ? titleView.getText() : "") + ": " + lastErr); } catch (Exception ignored) {} }
        finishing = true;
        final Intent r = new Intent();
        r.putExtra("status", status);
        long pos = 0, dur = 0;
        if (player != null) { pos = Math.max(0, player.getCurrentPosition()); long d = player.getDuration(); dur = (d == C.TIME_UNSET || live) ? 0 : d; }
        r.putExtra("fav", favChanged ? (favOn ? "1" : "0") : ""); r.putExtra("posMs", pos); r.putExtra("durMs", dur); r.putExtra("chIndex", chIndex); r.putExtra("epIndex", epAdvanced); r.putExtra("err", lastErr); r.putExtra("pick", pickIdx);
        // Movies/episodes: grab the frame we stopped on → "Continue watching" shows exactly where you are.
        if (!live && everPlayed && Build.VERSION.SDK_INT >= 24 && view != null && view.getVideoSurfaceView() instanceof SurfaceView
                && player != null && player.getVideoSize().width > 0) {
            try {
                int vw = player.getVideoSize().width, vh = player.getVideoSize().height;
                int w = 480, hgt = Math.max(1, Math.round(480f * vh / vw));
                final Bitmap bmp = Bitmap.createBitmap(w, hgt, Bitmap.Config.ARGB_8888);
                final boolean[] done = {false};
                final Runnable finishNow = () -> { if (done[0]) return; done[0] = true; setResult(RESULT_OK, r); finish(); };
                PixelCopy.request((SurfaceView) view.getVideoSurfaceView(), bmp, result -> {
                    if (result == PixelCopy.SUCCESS) {
                        try { ByteArrayOutputStream bo = new ByteArrayOutputStream();
                            bmp.compress(Bitmap.CompressFormat.JPEG, 68, bo);
                            r.putExtra("thumb", "data:image/jpeg;base64," + Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP));
                        } catch (Exception ignored) {}
                    }
                    finishNow.run();
                }, h);
                h.postDelayed(finishNow, 800);   // never hang on exit
                return;
            } catch (Exception ignored) {}
        }
        setResult(RESULT_OK, r);
        finish();
    }

    @Override public void onBackPressed() { if (epPanelShowing()) { hideEpisodes(); return; } if (upNextShowing()) { hideUpNext(); finishWith("ended"); return; } finishWith("ok"); }

    @Override public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (upNextShowing()) {
            if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER || keyCode == KeyEvent.KEYCODE_MEDIA_NEXT || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY) { playNextEpisode(); return true; }
            if (keyCode == KeyEvent.KEYCODE_BACK) { hideUpNext(); finishWith("ended"); return true; }
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_NEXT && !live && epAdvanced < nextEps.size()) { playNextEpisode(); return true; }
        if (unavailableShown && (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER)) {
            retries = 0; everPlayed = false; spinner.setVisibility(View.VISIBLE);
            load(live && !channels.isEmpty() ? channels.get(chIndex).url : qualities.get(qIndex).url, 0); return true; }
        if (alertShowing()) {
            if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER) { if (!alertUrl.isEmpty()) watchAlert(); else hideAlert.run(); return true; }
            if (keyCode == KeyEvent.KEYCODE_BACK) { h.removeCallbacks(hideAlert); hideAlert.run(); return true; }
        }
        if (keyCode == KeyEvent.KEYCODE_BACK) { finishWith("ok"); return true; }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE && player != null) { player.setPlayWhenReady(!player.getPlayWhenReady()); return true; }
        if (live && (keyCode == KeyEvent.KEYCODE_CHANNEL_UP || (keyCode == KeyEvent.KEYCODE_DPAD_UP && !view.isControllerFullyVisible()))) { zap(-1); return true; }
        if (live && (keyCode == KeyEvent.KEYCODE_CHANNEL_DOWN || (keyCode == KeyEvent.KEYCODE_DPAD_DOWN && !view.isControllerFullyVisible()))) { zap(1); return true; }
        if (!view.isControllerFullyVisible() && (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER)) { view.showController(); return true; }
        return super.onKeyDown(keyCode, event);
    }

    @Override protected void onPause() { if (current() == this) currentRef = null; super.onPause(); if (player != null) player.pause(); }
    @Override protected void onResume() { super.onResume(); currentRef = new java.lang.ref.WeakReference<>(this); hideSystemUi(); if (player != null && everPlayed) player.play(); }
    @Override protected void onDestroy() { if (current() == this) currentRef = null; h.removeCallbacksAndMessages(null); StreamTuning.saveBandwidth(this, meter); unwatchNetwork(); if (player != null) { player.release(); player = null; } super.onDestroy(); }

    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    private int dp(int v) { return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics())); }
}
