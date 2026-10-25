package com.wexlot.byoplayerpro;

import android.app.ActivityManager;
import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.Timeline;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.trackselection.AdaptiveTrackSelection;
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector;
import androidx.media3.exoplayer.upstream.DefaultAllocator;
import androidx.media3.exoplayer.upstream.DefaultBandwidthMeter;
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy;
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy;

import java.io.FileNotFoundException;
import java.io.IOException;

/**
 * Playback-continuity tuning for the native player: buffer sizes, adaptive bitrate (ABR) rules and
 * segment error handling. The idea throughout is "a softer picture is better than a spinner".
 *
 * How the pieces work together on a weak connection:
 *   1. Start fast at a quality the connection can actually carry (remembered bandwidth, not a guess).
 *   2. Keep a deep forward buffer, so a dropout of 30 s or more plays out of memory.
 *   3. ABR steps quality down early (while the buffer is still healthy) and up slowly.
 *   4. A segment that is slow or fails moves to a lighter rendition instead of retrying the same one.
 *   5. After a stall, playback only resumes once a real cushion is rebuilt, and the cushion grows
 *      with each stall, so it never "plays 1 s, stalls, plays 1 s" again.
 */
@OptIn(markerClass = UnstableApi.class)
public final class StreamTuning {
    private StreamTuning() {}

    // ------------------------------------------------------------------ buffer (LoadControl)

    // VOD (movies / episodes)
    static final int VOD_MIN_BUFFER_MS = 30_000;      // keep fetching until at least 30 s is ready ahead...
    static final int VOD_MAX_BUFFER_MS = 120_000;     // ...and keep going up to 120 s when memory allows
    static final int VOD_START_MS = 2_500;            // first frame after 2.5 s of media: starts quickly
    static final int VOD_RESUME_BASE_MS = 8_000;      // after a stall: rebuild at least 8 s before resuming
    static final int VOD_RESUME_MAX_MS = 20_000;      // each further stall raises that up to 20 s
    static final int VOD_BACK_BUFFER_MS = 15_000;     // keep the last 15 s so a short rewind needs no download

    // Live channels (the live edge limits how much can exist ahead of us)
    static final int LIVE_MIN_BUFFER_MS = 20_000;
    static final int LIVE_MAX_BUFFER_MS = 50_000;
    static final int LIVE_START_MS = 2_500;
    static final int LIVE_RESUME_BASE_MS = 5_000;
    static final int LIVE_RESUME_MAX_MS = 12_000;     // stays below the 20 s live offset, so it can always be met

    /**
     * Memory budget for the forward buffer: 30% of this device's app heap, between 24 and 160 MB.
     * Cheap TVs have a small heap; buffering by time alone ran them out of memory mid-movie. Here,
     * whichever limit is hit first (120 s or the byte budget) stops loading.
     * Example: 8 Mbps video = 1 MB/s, so a 96 MB budget holds about 96 s.
     */
    static int bufferBudgetBytes(Context ctx) {
        int heapMb = 192;
        try {
            ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            heapMb = (int) Math.min(Runtime.getRuntime().maxMemory() / (1024 * 1024), am.getLargeMemoryClass());
        } catch (Exception ignored) {}
        return Math.max(24, Math.min(160, (int) (heapMb * 0.30))) * 1024 * 1024;
    }

    static ContinuityLoadControl buildLoadControl(Context ctx, boolean live) {
        DefaultAllocator alloc = new DefaultAllocator(true, C.DEFAULT_BUFFER_SEGMENT_SIZE);
        int budget = bufferBudgetBytes(ctx);
        return live
            ? new ContinuityLoadControl(alloc, LIVE_MIN_BUFFER_MS, LIVE_MAX_BUFFER_MS, LIVE_START_MS, LIVE_RESUME_BASE_MS,
                    budget, /*prioritizeTime*/ true, /*backBuffer*/ 0, false, LIVE_RESUME_MAX_MS, budget)
            : new ContinuityLoadControl(alloc, VOD_MIN_BUFFER_MS, VOD_MAX_BUFFER_MS, VOD_START_MS, VOD_RESUME_BASE_MS,
                    budget, /*prioritizeTime*/ false, VOD_BACK_BUFFER_MS, true, VOD_RESUME_MAX_MS, budget);
    }

    /**
     * DefaultLoadControl plus an escalating "resume after stall" threshold.
     *
     * Plain ExoPlayer resumes as soon as bufferForPlaybackAfterRebufferMs is ready (a fixed few
     * seconds). On a connection that delivers slightly less than the bitrate, that gives a cycle of
     * play 5 s / stall / play 5 s. Here every stall within a few minutes raises the bar by 4 s
     * (8 → 12 → 16 → 20 s for VOD), so the player waits once for a meaningful cushion and then plays
     * through. After 3 minutes without a stall the bar falls back to the base.
     */
    static final class ContinuityLoadControl extends DefaultLoadControl {
        private final int resumeBaseMs, resumeMaxMs, targetBytes;
        private volatile int resumeMs;
        private volatile long lastStallAt = 0;

        ContinuityLoadControl(DefaultAllocator a, int minMs, int maxMs, int startMs, int resumeBaseMs, int targetBytes,
                              boolean prioritizeTime, int backMs, boolean retainBackFromKeyframe, int resumeMaxMs, int budget) {
            super(a, minMs, maxMs, startMs, resumeBaseMs, targetBytes, prioritizeTime, backMs, retainBackFromKeyframe);
            this.resumeBaseMs = resumeBaseMs; this.resumeMaxMs = resumeMaxMs; this.resumeMs = resumeBaseMs; this.targetBytes = budget;
        }

        /** Called by the player each time playback stalls after it had started. */
        void noteStall() {
            long now = System.currentTimeMillis();
            if (now - lastStallAt > 180_000) resumeMs = resumeBaseMs;           // first stall in a while: base bar
            else resumeMs = Math.min(resumeMaxMs, resumeMs + 4_000);             // repeated stalls: raise the bar
            lastStallAt = now;
        }
        /** Called after a long stretch of smooth playback, or on a new title/channel. */
        void reset() { resumeMs = resumeBaseMs; lastStallAt = 0; }
        int resumeThresholdMs() { return resumeMs; }

        @Override
        public boolean shouldStartPlayback(Timeline timeline, MediaSource.MediaPeriodId id, long bufferedDurationUs,
                                          float playbackSpeed, boolean rebuffering, long targetLiveOffsetUs) {
            if (!super.shouldStartPlayback(timeline, id, bufferedDurationUs, playbackSpeed, rebuffering, targetLiveOffsetUs)) return false;
            if (!rebuffering) return true;                                         // first start: keep it fast
            long needUs = (long) (resumeMs * 1000L / Math.max(0.5f, playbackSpeed)); // media time needed at this speed
            if (bufferedDurationUs >= needUs) return true;
            // Never wait for more than memory can hold: if the byte budget is already full, play now.
            return getAllocator().getTotalBytesAllocated() >= targetBytes;
        }
    }

    // ------------------------------------------------------------------ bandwidth estimate

    private static final String PREFS = "byo_player_net", KEY_BW = "bw_bps";

    /**
     * Start with the bandwidth the last session actually measured (x0.8 for safety), instead of a fixed
     * guess. The first video segments are chosen from this number: guessing 3 Mbps on a 1 Mbps line
     * meant the very first segment was too heavy and the movie stalled before it got going.
     * With no history yet, Media3's own defaults per country and network type are used.
     */
    static DefaultBandwidthMeter buildBandwidthMeter(Context ctx) {
        DefaultBandwidthMeter.Builder b = new DefaultBandwidthMeter.Builder(ctx).setResetOnNetworkTypeChange(true);
        long saved = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_BW, 0);
        if (saved > 200_000) b.setInitialBitrateEstimate((long) (saved * 0.8));
        return b.build();
    }

    /** The bandwidth measured in earlier sessions (bits/s), 0 when unknown. */
    static long savedBandwidth(Context ctx) {
        try { return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_BW, 0); } catch (Exception e) { return 0; } }
    /** Remember what this session measured, for the next start. */
    static void saveBandwidth(Context ctx, DefaultBandwidthMeter meter) {
        try {
            long est = meter == null ? 0 : meter.getBitrateEstimate();
            if (est > 200_000 && est < 1_000_000_000L) {
                SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                long old = p.getLong(KEY_BW, 0);
                // Smooth across sessions so one unusually fast or slow session does not swing it too far.
                long v = old > 0 ? (long) (old * 0.4 + est * 0.6) : est;
                p.edit().putLong(KEY_BW, v).apply();
            }
        } catch (Exception ignored) {}
    }

    // ------------------------------------------------------------------ ABR / track selection

    /**
     * Continuity-first ABR (HLS and DASH; single-bitrate streams are unaffected):
     *   - bandwidthFraction 0.65: a rendition is only "affordable" if it needs at most 65% of the
     *     measured throughput, leaving 35% headroom for the dips typical of mobile and Wi-Fi links.
     *     Example: 4 Mbps measured, so 2.6 Mbps is the most it will pick (720p, not 1080p at 5 Mbps).
     *   - minDurationForQualityIncreaseMs 15 s: go UP only when 15 s or more is already buffered,
     *     so an upgrade can never drain the buffer into a stall.
     *   - maxDurationForQualityDecreaseMs 30 s: go DOWN as soon as the buffer is below 30 s and the
     *     estimate says the current rendition is too heavy. That is early, while there is time to
     *     switch without anyone noticing.
     *   - minDurationToRetainAfterDiscardMs 20 s: when stepping up, keep the 20 s already buffered at
     *     the lower quality instead of throwing it away and refetching (which caused stalls).
     */
    static DefaultTrackSelector buildTrackSelector(Context ctx) {
        AdaptiveTrackSelection.Factory abr = new AdaptiveTrackSelection.Factory(
                /*minDurationForQualityIncreaseMs*/ 15_000,
                /*maxDurationForQualityDecreaseMs*/ 30_000,
                /*minDurationToRetainAfterDiscardMs*/ 20_000,
                /*bandwidthFraction*/ 0.65f);
        DefaultTrackSelector sel = new DefaultTrackSelector(ctx, abr);
        sel.setParameters(sel.buildUponParameters()
                .setViewportSizeToPhysicalDisplaySize(ctx, true)   // never fetch above the screen's resolution
                .setExceedVideoConstraintsIfNecessary(true)        // but always play something, even if every rendition is heavier
                .setAllowVideoMixedMimeTypeAdaptiveness(true)      // may switch between codecs (e.g. HEVC and H.264 ladders)
                .setAllowVideoNonSeamlessAdaptiveness(true)        // and between renditions that need a decoder reset
                .setAllowMultipleAdaptiveSelections(true)
                .build());
        return sel;
    }

    // ------------------------------------------------------------------ segment errors

    /**
     * How failed downloads are handled before anything reaches the screen:
     *   - A segment that times out or drops mid-download on an adaptive stream is treated as "this
     *     rendition is too heavy right now": that rendition is excluded for 20 s and the player
     *     continues on a lighter one, instead of retrying the same heavy segment.
     *   - HTTP 403/404/410/416/5xx: same, using Media3's normal exclusion (60 s).
     *   - Retries use exponential backoff: 0.5, 1, 2, 4, 4... seconds.
     *   - A broken or unsupported file is not retried at all (retrying cannot fix it).
     *   - Each segment is retried up to 8 times (live playlists: 10), which rides out about 30 s of
     *     dropout before the player-level recovery in PlayerActivity takes over.
     */
    static final class ContinuityErrorPolicy extends DefaultLoadErrorHandlingPolicy {
        ContinuityErrorPolicy() { super(8); }

        @Override
        public LoadErrorHandlingPolicy.FallbackSelection getFallbackSelectionFor(LoadErrorHandlingPolicy.FallbackOptions options,
                                                                                LoadErrorHandlingPolicy.LoadErrorInfo info) {
            IOException e = info.exception;
            boolean slowOrCut = e instanceof HttpDataSource.HttpDataSourceException
                    && !(e instanceof HttpDataSource.InvalidResponseCodeException);
            if (slowOrCut && options.isFallbackAvailable(FALLBACK_TYPE_TRACK))
                return new LoadErrorHandlingPolicy.FallbackSelection(FALLBACK_TYPE_TRACK, 20_000);
            return super.getFallbackSelectionFor(options, info);   // HTTP error codes: Media3's own rules
        }

        @Override
        public long getRetryDelayMsFor(LoadErrorHandlingPolicy.LoadErrorInfo info) {
            IOException e = info.exception;
            if (e instanceof androidx.media3.common.ParserException || e instanceof FileNotFoundException
                    || e instanceof HttpDataSource.CleartextNotPermittedException) return C.TIME_UNSET;
            return Math.min(4_000L, 500L << Math.min(4, info.errorCount - 1));
        }

        @Override
        public int getMinimumLoadableRetryCount(int dataType) {
            return dataType == C.DATA_TYPE_MANIFEST ? 10 : 8;
        }
    }
}
