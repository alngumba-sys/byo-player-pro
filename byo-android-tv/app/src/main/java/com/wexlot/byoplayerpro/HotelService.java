package com.wexlot.byoplayerpro;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Hotel mode: keeps a light background check going while the TV is "off" (screen asleep). When the
 * check-in system leaves a welcome for this room, wake the screen and open BYO Player on the welcome page.
 */
public class HotelService extends Service {
    static final String PREFS = "byo_hotel";
    private volatile boolean running = false;
    private Thread worker;
    private PowerManager.WakeLock cpuLock;

    static void apply(Context c) {
        try {
            SharedPreferences sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            Intent i = new Intent(c, HotelService.class);
            if (sp.getBoolean("enabled", false) && !sp.getString("room", "").isEmpty()) {
                if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
            } else c.stopService(i);
        } catch (Throwable ignored) {}
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel ch = new NotificationChannel("byo_hotel", "Hotel mode", NotificationManager.IMPORTANCE_MIN);
                ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(ch);
            }
            Notification.Builder nb = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "byo_hotel") : new Notification.Builder(this);
            nb.setContentTitle("BYO Player: Hotel mode").setContentText("Ready to welcome guests").setSmallIcon(getApplicationInfo().icon);
            startForeground(4107, nb.build());
        } catch (Throwable ignored) {}
        try {
            if (cpuLock == null) { PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                cpuLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "byo:hotel-cpu"); cpuLock.setReferenceCounted(false); }
            if (!cpuLock.isHeld()) cpuLock.acquire();
        } catch (Throwable ignored) {}
        if (!running) { running = true; worker = new Thread(new Runnable() { public void run() { loop(); } }, "byo-hotel"); worker.setDaemon(true); worker.start(); }
        return START_STICKY;
    }

    @Override public void onDestroy() {
        running = false;
        try { if (cpuLock != null && cpuLock.isHeld()) cpuLock.release(); } catch (Throwable ignored) {}
        super.onDestroy();
    }

    private void loop() {
        while (running) {
            try {
                SharedPreferences sp = getSharedPreferences(PREFS, MODE_PRIVATE);
                String url = sp.getString("url", ""), key = sp.getString("key", ""), room = sp.getString("room", "");
                if (!sp.getBoolean("enabled", false) || room.isEmpty() || url.isEmpty()) { stopSelf(); return; }
                String name = poll(url, key, room);
                if (name != null) welcome(name);
            } catch (Throwable ignored) {}
            try { Thread.sleep(4000); } catch (InterruptedException e) { return; }
        }
    }

    /** Returns the guest name when a welcome is waiting, else null. */
    private String poll(String url, String key, String room) {
        java.net.HttpURLConnection c = null;
        try {
            c = (java.net.HttpURLConnection) new java.net.URL(url + "/rest/v1/rpc/byo_hotel_poll").openConnection();
            c.setRequestMethod("POST"); c.setDoOutput(true); c.setConnectTimeout(8000); c.setReadTimeout(8000);
            c.setRequestProperty("apikey", key); c.setRequestProperty("Authorization", "Bearer " + key);
            c.setRequestProperty("Content-Type", "application/json");
            byte[] body = new org.json.JSONObject().put("p_room", room).toString().getBytes("UTF-8");
            c.getOutputStream().write(body);
            if (c.getResponseCode() / 100 != 2) return null;
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream(); byte[] b = new byte[2048]; int n;
            java.io.InputStream in = c.getInputStream(); while ((n = in.read(b)) > 0) bo.write(b, 0, n);
            String s = bo.toString("UTF-8").trim();
            if (s.isEmpty() || s.equals("null")) return null;
            return new org.json.JSONObject(s).optString("name", "");
        } catch (Throwable t) { return null; }
        finally { if (c != null) try { c.disconnect(); } catch (Throwable ignored) {} }
    }

    private void welcome(String name) {
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            PowerManager.WakeLock wl = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "byo:hotel-wake");
            wl.acquire(15000);
        } catch (Throwable ignored) {}
        try {
            Intent i = new Intent(this, MainActivity.class);
            i.putExtra("byo_welcome", name);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(i);
        } catch (Throwable ignored) {}
    }
}
