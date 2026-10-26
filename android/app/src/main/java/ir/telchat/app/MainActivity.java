package ir.telchat.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/** نمایش برنامه وب تل‌چت داخل WebView به‌همراه امکانات بومی اندروید */
public class MainActivity extends Activity {
    private static final int REQ_FILE = 11;
    private static final int REQ_MIC = 12;
    private static final int REQ_NOTIF = 13;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingPermission;
    private long pendingChat = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        NotifyService.createChannels(this);
        pendingChat = getIntent().getLongExtra("chat_id", 0);
        if (Prefs.server(this).isEmpty()) {
            showSetup();
        } else {
            showWeb();
        }
    }

    /* ---------------- صفحه تنظیم آدرس سرور ---------------- */

    private void showSetup() {
        int pad = dp(24);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setPadding(pad, pad, pad, pad);
        box.setBackgroundColor(Color.WHITE);

        TextView title = new TextView(this);
        title.setText(getString(R.string.app_name));
        title.setTextSize(28);
        title.setTextColor(Color.BLACK);
        title.setGravity(Gravity.CENTER);
        box.addView(title);

        TextView sub = new TextView(this);
        sub.setText("آدرس سرور پیام‌رسان را وارد کنید\n(مثلاً chat.example.ir)");
        sub.setTextSize(15);
        sub.setTextColor(Color.GRAY);
        sub.setGravity(Gravity.CENTER);
        sub.setPadding(0, dp(12), 0, dp(20));
        box.addView(sub);

        final EditText input = new EditText(this);
        input.setHint("https://chat.example.ir");
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setTextDirection(View.TEXT_DIRECTION_LTR);
        input.setSingleLine(true);
        box.addView(input, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Button ok = new Button(this);
        ok.setText("اتصال");
        ok.setTextColor(Color.WHITE);
        ok.setBackgroundColor(Color.parseColor("#3390EC"));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        lp.topMargin = dp(20);
        box.addView(ok, lp);
        ok.setOnClickListener(v -> {
            String url = Prefs.normalize(input.getText().toString());
            if (url.isEmpty() || !URLUtil.isNetworkUrl(url)) {
                Toast.makeText(this, "آدرس معتبر وارد کنید", Toast.LENGTH_SHORT).show();
                return;
            }
            Prefs.setServer(this, url);
            showWeb();
        });
        setContentView(box);
    }

    /* ---------------- WebView ---------------- */

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void showWeb() {
        web = new WebView(this);
        web.setBackgroundColor(Color.WHITE);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " TelchatAndroid/" + BuildConfig.VERSION_NAME);

        web.addJavascriptInterface(new Bridge(), "TelchatAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                Uri base = Uri.parse(Prefs.server(MainActivity.this));
                String path = u.getPath() == null ? "" : u.getPath();
                if (u.getHost() != null && u.getHost().equals(base.getHost()) && !path.contains("/uploads/") && !path.endsWith(".apk")) {
                    return false;
                }
                openExternal(u);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (pendingChat > 0) {
                    openChat(pendingChat);
                    pendingChat = 0;
                }
            }

            @Override
            public void onReceivedError(WebView view, android.webkit.WebResourceRequest req, android.webkit.WebResourceError err) {
                if (req.isForMainFrame()) {
                    String html = "<html dir='rtl'><body style='font-family:sans-serif;text-align:center;padding:40px;color:#555'>"
                            + "<h3>اتصال به سرور برقرار نشد</h3><p>اینترنت یا آدرس سرور را بررسی کنید.</p>"
                            + "<p><button onclick='location.reload()' style='padding:10px 24px;border:0;border-radius:8px;background:#3390ec;color:#fff;font-size:16px'>تلاش دوباره</button></p>"
                            + "<p><a href='telchat://setup' style='color:#3390ec'>تغییر آدرس سرور</a></p></body></html>";
                    view.loadDataWithBaseURL(Prefs.server(MainActivity.this), html, "text/html", "utf-8", req.getUrl().toString());
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                String[] types = params.getAcceptTypes();
                i.setType(types.length > 0 && types[0] != null && !types[0].isEmpty() ? types[0] : "*/*");
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                    i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                try {
                    startActivityForResult(Intent.createChooser(i, "انتخاب فایل"), REQ_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    for (String r : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) {
                            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                                request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                            } else {
                                pendingPermission = request;
                                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
                            }
                            return;
                        }
                    }
                    request.deny();
                });
            }
        });
        web.setDownloadListener((url, ua, disposition, mime, length) -> download(url, disposition, mime));

        String url = Prefs.server(this);
        if (pendingChat > 0) {
            url += "#/chat/" + pendingChat;
            pendingChat = 0;
        }
        web.loadUrl(url);
        askNotificationPermission();
    }

    private void openChat(long chatId) {
        if (web != null) {
            web.evaluateJavascript("window.telchatOpenChat && window.telchatOpenChat(" + chatId + ")", null);
        }
        NotifyService.clearChat(this, chatId);
    }

    private void openExternal(Uri u) {
        if ("telchat".equals(u.getScheme())) {
            showSetupDialog();
            return;
        }
        if (u.getPath() != null && u.getPath().contains("/uploads/")) {
            download(u.toString(), null, null);
            return;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (ActivityNotFoundException ignored) {
            Toast.makeText(this, "برنامه‌ای برای باز کردن لینک پیدا نشد", Toast.LENGTH_SHORT).show();
        }
    }

    private void download(String url, String disposition, String mime) {
        try {
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            String name = URLUtil.guessFileName(url, disposition, mime);
            r.setTitle(name);
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            dm.enqueue(r);
            Toast.makeText(this, "در حال دانلود: " + name, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            openExternalBrowser(url);
        }
    }

    private void openExternalBrowser(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (ActivityNotFoundException ignored) {
            // ignore
        }
    }

    private void showSetupDialog() {
        final EditText input = new EditText(this);
        input.setText(Prefs.server(this));
        input.setTextDirection(View.TEXT_DIRECTION_LTR);
        new AlertDialog.Builder(this)
                .setTitle("آدرس سرور")
                .setView(input)
                .setPositiveButton("ذخیره", (d, w) -> {
                    String url = Prefs.normalize(input.getText().toString());
                    if (!url.isEmpty()) {
                        Prefs.setServer(this, url);
                        Prefs.clearSession(this);
                        web.loadUrl(url);
                    }
                })
                .setNegativeButton("لغو", null)
                .show();
    }

    private void askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
        }
    }

    /** برای اینکه اندروید سرویس دریافت پیام را نبندد، از کاربر می‌خواهیم بهینه‌سازی باتری را غیرفعال کند */
    @SuppressLint("BatteryLife")
    private void askBatteryExemption() {
        if (Prefs.askedBattery(this)) {
            return;
        }
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm == null || pm.isIgnoringBatteryOptimizations(getPackageName())) {
            return;
        }
        Prefs.setAskedBattery(this);
        new AlertDialog.Builder(this)
                .setTitle("دریافت پیام در پس‌زمینه")
                .setMessage("برای اینکه اعلان پیام‌ها حتی وقتی برنامه بسته است برسد، در صفحه بعد اجازه «اجرا در پس‌زمینه» (عدم بهینه‌سازی باتری) را بدهید.")
                .setPositiveButton("ادامه", (d, w) -> {
                    try {
                        Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                        i.setData(Uri.parse("package:" + getPackageName()));
                        startActivity(i);
                    } catch (Exception ignored) {
                        // ignore
                    }
                })
                .setNegativeButton("بعداً", null)
                .show();
    }

    /* ---------------- پل جاوااسکریپت ---------------- */

    private class Bridge {
        @JavascriptInterface
        public void setSession(String base, String token) {
            if (token == null || token.isEmpty()) {
                return;
            }
            Prefs.setSession(MainActivity.this, token);
            runOnUiThread(() -> {
                NotifyService.start(MainActivity.this);
                askBatteryExemption();
            });
        }

        @JavascriptInterface
        public void clearSession() {
            Prefs.clearSession(MainActivity.this);
            NotifyService.clearAll(MainActivity.this);
            NotifyService.stop(MainActivity.this);
        }

        @JavascriptInterface
        public void clearNotifications(long chatId) {
            NotifyService.clearChat(MainActivity.this, chatId);
        }

        @JavascriptInterface
        public void setPreview(boolean v) {
            Prefs.setPreview(MainActivity.this, v);
        }

        @JavascriptInterface
        public void changeServer() {
            runOnUiThread(MainActivity.this::showSetupDialog);
        }

        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME;
        }
    }

    /* ---------------- چرخه حیات ---------------- */

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        long chat = intent.getLongExtra("chat_id", 0);
        if (chat > 0) {
            openChat(chat);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        Prefs.foreground = true;
        if (web != null) {
            web.onResume();
        }
        NotifyService.start(this);
    }

    @Override
    protected void onPause() {
        Prefs.foreground = false;
        if (web != null) {
            web.onPause();
        }
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (web != null) {
            web.evaluateJavascript("(function(){var m=document.querySelector('.modal-wrap,.viewer,.ctx-menu');"
                    + "if(m){var b=document.querySelector('.ctx-backdrop');if(b){b.click();return 1;}"
                    + "var x=m.querySelector('[data-mclose],.v-top button,[data-v=__cancel]');if(x){x.click();}else{m.remove();}return 1;}"
                    + "if(document.body.classList.contains('chat-open')&&window.closeChat){closeChat();return 1;}return 0;})()", value -> {
                if (!"1".equals(value)) {
                    moveTaskToBack(true);
                }
            });
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE || fileCallback == null) {
            return;
        }
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                result = new Uri[n];
                for (int i = 0; i < n; i++) {
                    result[i] = data.getClipData().getItemAt(i).getUri();
                }
            } else if (data.getData() != null) {
                result = new Uri[]{data.getData()};
            }
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQ_MIC && pendingPermission != null) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                pendingPermission.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            } else {
                pendingPermission.deny();
            }
            pendingPermission = null;
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
