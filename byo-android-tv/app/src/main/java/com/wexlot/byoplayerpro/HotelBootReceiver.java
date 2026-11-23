package com.wexlot.byoplayerpro;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** After the TV starts (or the app is updated), bring Hotel mode back if it was on. */
public class HotelBootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context ctx, Intent intent) { HotelService.apply(ctx); }
}
