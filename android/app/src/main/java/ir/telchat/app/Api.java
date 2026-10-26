package ir.telchat.app;

import android.content.Context;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** فراخوانی API سرور تل‌چت (مستقیم، بدون هیچ سرویس واسط) */
public final class Api {
    public static class AuthException extends IOException {
        AuthException() {
            super("unauthorized");
        }
    }

    private Api() {
    }

    public static JSONObject call(Context c, String action, JSONObject body, int readTimeoutMs) throws IOException {
        String server = Prefs.server(c);
        String token = Prefs.token(c);
        if (server.isEmpty() || token.isEmpty()) {
            throw new AuthException();
        }
        HttpURLConnection con = (HttpURLConnection) new URL(server + "api/index.php?action=" + action).openConnection();
        try {
            con.setRequestMethod("POST");
            con.setConnectTimeout(15000);
            con.setReadTimeout(readTimeoutMs);
            con.setDoOutput(true);
            con.setUseCaches(false);
            con.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            con.setRequestProperty("X-Auth-Token", token);
            con.setRequestProperty("User-Agent", "TelchatAndroid/" + BuildConfig.VERSION_NAME);
            byte[] data = body.toString().getBytes(StandardCharsets.UTF_8);
            con.setFixedLengthStreamingMode(data.length);
            OutputStream os = con.getOutputStream();
            os.write(data);
            os.close();
            int code = con.getResponseCode();
            if (code == 401) {
                throw new AuthException();
            }
            InputStream in = code >= 400 ? con.getErrorStream() : con.getInputStream();
            if (in == null) {
                throw new IOException("http " + code);
            }
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] b = new byte[8192];
            int n;
            while ((n = in.read(b)) > 0) {
                buf.write(b, 0, n);
            }
            in.close();
            JSONObject res = new JSONObject(new String(buf.toByteArray(), StandardCharsets.UTF_8));
            if (res.has("error")) {
                throw new IOException(res.optString("error"));
            }
            return res;
        } catch (JSONException e) {
            throw new IOException("bad json", e);
        } finally {
            con.disconnect();
        }
    }
}
