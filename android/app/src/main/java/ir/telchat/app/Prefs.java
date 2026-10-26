package ir.telchat.app;

import android.content.Context;
import android.content.SharedPreferences;

/** تنظیمات ذخیره شده اپ: آدرس سرور، توکن ورود و آخرین رویداد دریافت شده */
public final class Prefs {
    private static final String NAME = "telchat";

    /** آیا صفحه برنامه هم‌اکنون جلوی چشم کاربر است (در این حالت نوتیف نمایش داده نمی‌شود) */
    public static volatile boolean foreground = false;

    private Prefs() {
    }

    private static SharedPreferences sp(Context c) {
        return c.getApplicationContext().getSharedPreferences(NAME, Context.MODE_PRIVATE);
    }

    public static String server(Context c) {
        String s = sp(c).getString("server", "");
        if (s.isEmpty()) {
            s = BuildConfig.SERVER_URL;
        }
        return normalize(s);
    }

    public static void setServer(Context c, String url) {
        sp(c).edit().putString("server", normalize(url)).apply();
    }

    public static String normalize(String url) {
        if (url == null) {
            return "";
        }
        url = url.trim();
        if (url.isEmpty()) {
            return "";
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "https://" + url;
        }
        int hash = url.indexOf('#');
        if (hash >= 0) {
            url = url.substring(0, hash);
        }
        if (url.endsWith("index.html")) {
            url = url.substring(0, url.length() - "index.html".length());
        }
        if (!url.endsWith("/")) {
            url = url + "/";
        }
        return url;
    }

    public static String token(Context c) {
        return sp(c).getString("token", "");
    }

    public static void setSession(Context c, String token) {
        SharedPreferences.Editor e = sp(c).edit();
        if (!token.equals(token(c))) {
            e.putLong("last_id", -1);
        }
        e.putString("token", token).apply();
    }

    public static void clearSession(Context c) {
        sp(c).edit().remove("token").putLong("last_id", -1).apply();
    }

    public static long lastId(Context c) {
        return sp(c).getLong("last_id", -1);
    }

    public static void setLastId(Context c, long id) {
        sp(c).edit().putLong("last_id", id).apply();
    }

    public static boolean preview(Context c) {
        return sp(c).getBoolean("preview", true);
    }

    public static void setPreview(Context c, boolean v) {
        sp(c).edit().putBoolean("preview", v).apply();
    }

    public static boolean askedBattery(Context c) {
        return sp(c).getBoolean("asked_battery", false);
    }

    public static void setAskedBattery(Context c) {
        sp(c).edit().putBoolean("asked_battery", true).apply();
    }
}
