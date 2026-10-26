package ir.telchat.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** پس از روشن شدن گوشی یا به‌روزرسانی اپ، سرویس دریافت پیام دوباره اجرا می‌شود */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        NotifyService.start(context);
    }
}
