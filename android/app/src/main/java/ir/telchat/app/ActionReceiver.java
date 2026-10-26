package ir.telchat.app;

import android.app.NotificationManager;
import android.app.RemoteInput;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import org.json.JSONObject;

/** دکمه‌های داخل نوتیف: «پاسخ» و «خواندم» */
public class ActionReceiver extends BroadcastReceiver {
    public static final String ACTION_REPLY = "ir.telchat.app.REPLY";
    public static final String ACTION_READ = "ir.telchat.app.READ";
    public static final String KEY_TEXT = "reply_text";

    @Override
    public void onReceive(Context context, Intent intent) {
        final Context app = context.getApplicationContext();
        final long chatId = intent.getLongExtra("chat_id", 0);
        final long messageId = intent.getLongExtra("message_id", 0);
        final String action = intent.getAction();
        CharSequence text = null;
        Bundle results = RemoteInput.getResultsFromIntent(intent);
        if (results != null) {
            text = results.getCharSequence(KEY_TEXT);
        }
        final String reply = text == null ? "" : text.toString().trim();
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                if (ACTION_REPLY.equals(action) && !reply.isEmpty()) {
                    JSONObject b = new JSONObject();
                    b.put("chat_id", chatId);
                    b.put("body", reply);
                    Api.call(app, "messages.send", b, 20000);
                }
                JSONObject r = new JSONObject();
                r.put("chat_id", chatId);
                r.put("last_id", messageId);
                Api.call(app, "messages.read", r, 20000);
            } catch (Exception ignored) {
                // در صورت خطا کاربر می‌تواند از داخل برنامه پاسخ دهد
            } finally {
                NotifyService.clearChat(app, chatId);
                NotificationManager nm = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    nm.cancel((int) chatId);
                }
                pending.finish();
            }
        }).start();
    }
}
