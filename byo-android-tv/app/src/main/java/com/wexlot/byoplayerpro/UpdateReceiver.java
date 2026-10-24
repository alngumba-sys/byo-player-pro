package com.wexlot.byoplayerpro;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** After the app updates itself, reopen it on Home (only when the update was started from inside the app). */
public class UpdateReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context ctx, Intent intent) {
        if (intent == null || !Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) return;
        try {
            long t = ctx.getSharedPreferences("byo_diag", Context.MODE_PRIVATE).getLong(MainActivity.PREF_RELAUNCH, 0);
            if (t == 0 || System.currentTimeMillis() - t > 15 * 60 * 1000L) return;
            Intent i = new Intent(ctx, MainActivity.class);
            i.putExtra("byo_updated", true);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            ctx.startActivity(i);
        } catch (Exception ignored) {}
    }
}
