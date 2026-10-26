package ir.telchat.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * سرویس پس‌زمینه دریافت پیام.
 * مستقیماً به سرور خودتان وصل می‌شود (Long Polling) و هیچ وابستگی‌ای به
 * Google Play Services / Firebase ندارد؛ بنابراین هنگام قطعی اینترنت بین‌الملل هم کار می‌کند.
 */
public class NotifyService extends Service {
    private static final String CH_MESSAGES = "messages";
    private static final String CH_SERVICE = "service";
    private static final int SERVICE_ID = 0x7e1c;

    private static final Map<Long, List<String>> LINES = new HashMap<>();

    private volatile boolean running = false;
    private Thread worker;

    public static void start(Context c) {
        if (Prefs.token(c).isEmpty() || Prefs.server(c).isEmpty()) {
            return;
        }
        Intent i = new Intent(c, NotifyService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                c.startForegroundService(i);
            } else {
                c.startService(i);
            }
        } catch (Exception ignored) {
            // در برخی نسخه‌ها اجرای سرویس از پس‌زمینه محدود است؛ با باز شدن اپ دوباره اجرا می‌شود
        }
    }

    public static void stop(Context c) {
        c.stopService(new Intent(c, NotifyService.class));
    }

    public static synchronized void clearChat(Context c, long chatId) {
        LINES.remove(chatId);
        NotificationManager nm = (NotificationManager) c.getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.cancel((int) chatId);
        }
    }

    public static synchronized void clearAll(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) {
            for (Long id : LINES.keySet()) {
                nm.cancel(id.intValue());
            }
        }
        LINES.clear();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = buildServiceNotification();
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(SERVICE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
            } else {
                startForeground(SERVICE_ID, n);
            }
        } catch (Exception e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (Prefs.token(this).isEmpty()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!running) {
            running = true;
            worker = new Thread(this::loop, "telchat-poll");
            worker.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (worker != null) {
            worker.interrupt();
        }
        super.onDestroy();
    }

    private void loop() {
        int fails = 0;
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        while (running) {
            PowerManager.WakeLock wl = null;
            try {
                JSONObject body = new JSONObject();
                body.put("last_id", Prefs.lastId(this));
                body.put("wait", 25);
                JSONObject r = Api.call(this, "notify_poll", body, 45000);
                if (pm != null) {
                    wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "telchat:notify");
                    wl.acquire(10000);
                }
                Prefs.setLastId(this, r.optLong("last_id", -1));
                JSONArray read = r.optJSONArray("read");
                if (read != null) {
                    for (int i = 0; i < read.length(); i++) {
                        clearChat(this, read.optLong(i));
                    }
                }
                JSONArray notes = r.optJSONArray("notifications");
                if (notes != null && !Prefs.foreground) {
                    for (int i = 0; i < notes.length(); i++) {
                        show(notes.getJSONObject(i));
                    }
                }
                fails = 0;
            } catch (Api.AuthException e) {
                Prefs.clearSession(this);
                running = false;
                stopSelf();
                return;
            } catch (Exception e) {
                if (!running) {
                    return;
                }
                fails++;
                try {
                    Thread.sleep(Math.min(60000, 3000L * fails));
                } catch (InterruptedException ie) {
                    return;
                }
            } finally {
                if (wl != null && wl.isHeld()) {
                    wl.release();
                }
            }
        }
    }

    private synchronized void show(JSONObject n) {
        long chatId = n.optLong("chat_id");
        long messageId = n.optLong("message_id");
        boolean group = n.optBoolean("group");
        boolean preview = Prefs.preview(this);
        String title = n.optString("title");
        String body = preview ? n.optString("body") : "پیام جدید";
        String line = group && preview ? n.optString("sender") + ": " + body : body;

        List<String> lines = LINES.get(chatId);
        if (lines == null) {
            lines = new ArrayList<>();
            LINES.put(chatId, lines);
        }
        lines.add(line);
        while (lines.size() > 7) {
            lines.remove(0);
        }

        Intent open = new Intent(this, MainActivity.class);
        open.setAction("open_chat_" + chatId);
        open.putExtra("chat_id", chatId);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent contentPi = PendingIntent.getActivity(this, (int) chatId, open, piFlags);

        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH_MESSAGES) : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_notification)
                .setColor(Color.parseColor("#3390EC"))
                .setContentTitle(title)
                .setContentText(line)
                .setWhen(n.optLong("created_at") * 1000)
                .setShowWhen(true)
                .setAutoCancel(true)
                .setNumber(lines.size())
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setContentIntent(contentPi);
        if (Build.VERSION.SDK_INT < 26) {
            b.setPriority(Notification.PRIORITY_HIGH)
                    .setDefaults(Notification.DEFAULT_ALL);
        }
        if (lines.size() > 1) {
            Notification.InboxStyle style = new Notification.InboxStyle();
            for (String l : lines) {
                style.addLine(l);
            }
            style.setSummaryText(lines.size() + " پیام جدید");
            b.setStyle(style);
        } else {
            b.setStyle(new Notification.BigTextStyle().bigText(line));
        }

        if (Build.VERSION.SDK_INT >= 24) {
            Intent replyIntent = new Intent(this, ActionReceiver.class);
            replyIntent.setAction(ActionReceiver.ACTION_REPLY);
            replyIntent.putExtra("chat_id", chatId);
            replyIntent.putExtra("message_id", messageId);
            int mutable = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent replyPi = PendingIntent.getBroadcast(this, (int) chatId, replyIntent, mutable);
            RemoteInput ri = new RemoteInput.Builder(ActionReceiver.KEY_TEXT).setLabel("پاسخ...").build();
            b.addAction(new Notification.Action.Builder(null, "پاسخ", replyPi).addRemoteInput(ri).build());
        }
        Intent readIntent = new Intent(this, ActionReceiver.class);
        readIntent.setAction(ActionReceiver.ACTION_READ);
        readIntent.putExtra("chat_id", chatId);
        readIntent.putExtra("message_id", messageId);
        PendingIntent readPi = PendingIntent.getBroadcast(this, (int) (chatId + 1000000), readIntent, piFlags);
        b.addAction(new Notification.Action.Builder(null, "خواندم", readPi).build());

        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) {
            try {
                nm.notify((int) chatId, b.build());
            } catch (SecurityException ignored) {
                // اجازه نمایش اعلان داده نشده است
            }
        }
    }

    private Notification buildServiceNotification() {
        Intent open = new Intent(this, MainActivity.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, flags);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH_SERVICE) : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(getString(R.string.app_name))
                .setContentText("آماده دریافت پیام‌ها")
                .setOngoing(true)
                .setShowWhen(false)
                .setContentIntent(pi);
        if (Build.VERSION.SDK_INT < 26) {
            b.setPriority(Notification.PRIORITY_MIN);
        }
        return b.build();
    }

    static void createChannels(Context c) {
        if (Build.VERSION.SDK_INT < 26) {
            return;
        }
        NotificationManager nm = (NotificationManager) c.getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) {
            return;
        }
        NotificationChannel msg = new NotificationChannel(CH_MESSAGES, "پیام‌ها", NotificationManager.IMPORTANCE_HIGH);
        msg.setDescription("اعلان پیام‌های جدید");
        msg.enableVibration(true);
        msg.enableLights(true);
        msg.setLightColor(Color.parseColor("#3390EC"));
        msg.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_COMMUNICATION_INSTANT)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        nm.createNotificationChannel(msg);
        NotificationChannel svc = new NotificationChannel(CH_SERVICE, "اتصال پس‌زمینه", NotificationManager.IMPORTANCE_MIN);
        svc.setDescription("برای دریافت پیام وقتی برنامه بسته است. می‌توانید این اعلان را از تنظیمات گوشی پنهان کنید.");
        svc.setShowBadge(false);
        nm.createNotificationChannel(svc);
    }
}
