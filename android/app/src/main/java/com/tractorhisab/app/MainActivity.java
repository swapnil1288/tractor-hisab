package com.tractorhisab.app;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.ContactsContract;
import android.util.Base64;
import android.view.View;
import android.webkit.*;
import android.widget.*;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

public class MainActivity extends Activity {
    private static final int CONTACT = 1, SAVE = 2;
    private WebView web;
    private LinearLayout error;
    private String pendingId;
    private byte[] pendingData;
    private final String origin = "https://tractor-hishob.onrender.com";
    private boolean trusted(Uri uri) {
        return "https".equals(uri.getScheme()) &&
            "tractor-hishob.onrender.com".equals(uri.getHost()) &&
            (uri.getPort() == -1 || uri.getPort() == 443);
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(0xff1f6f43);
        getWindow().setNavigationBarColor(0xfff4f6f3);
        FrameLayout root = new FrameLayout(this);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        error = new LinearLayout(this);
        error.setOrientation(LinearLayout.VERTICAL);
        error.setPadding(32, 64, 32, 32);
        error.setBackgroundColor(0xfff4f6f3);
        TextView message = new TextView(this);
        message.setText(R.string.load_error);
        error.addView(message);
        Button retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setOnClickListener(v -> { error.setVisibility(View.GONE); web.reload(); });
        error.addView(retry);
        error.setVisibility(View.GONE);
        root.addView(error, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true);
        web.setWebChromeClient(new WebChromeClient());
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "TractorNative",
                Collections.singleton(origin), (view, msg, source, mainFrame, proxy) -> {
                    if (!mainFrame || !trusted(source)) return;
                    try {
                        JSONObject data = new JSONObject(msg.getData());
                        handle(data);
                    } catch (Exception ex) { toast(R.string.save_failed); }
                });
        } else { toast(R.string.unsupported); }
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                if (!req.isForMainFrame()) return false;
                Uri uri = req.getUrl();
                if (trusted(uri)) return false;
                external(uri);
                return true;
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (trusted(Uri.parse(url))) {
                    CookieManager.getInstance().flush();
                    try (java.io.InputStream in = getAssets().open("native.js")) {
                        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                        byte[] chunk = new byte[4096];
                        int n;
                        while ((n = in.read(chunk)) != -1) out.write(chunk, 0, n);
                        web.evaluateJavascript(new String(out.toByteArray(), StandardCharsets.UTF_8), null);
                    } catch (Exception ex) { toast(R.string.unsupported); }
                }
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) error.setVisibility(View.VISIBLE);
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest req, WebResourceResponse response) {
                if (req.isForMainFrame() && response.getStatusCode() >= 500) error.setVisibility(View.VISIBLE);
            }
            @Override public void onReceivedSslError(WebView view, android.webkit.SslErrorHandler handler, android.net.http.SslError err) {
                handler.cancel();
                error.setVisibility(View.VISIBLE);
            }
        });
        if (state == null || web.restoreState(state) == null) web.loadUrl(BuildConfig.APP_URL);
    }
    private void handle(JSONObject data) throws Exception {
        String id = data.getString("id");
        if (pendingId != null) { result(id, "null", "Another picker is already open"); return; }
        String type = data.getString("type");
        if ("contact".equals(type)) {
            pendingId = id;
            try { startActivityForResult(new Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI), CONTACT); }
            catch (Exception ex) { pendingId = null; result(id, "null", "Contact picker unavailable"); }
        } else if ("save".equals(type)) {
            String encoded = data.getString("data");
            if (encoded.length() > 28 * 1024 * 1024) { result(id, "null", "File too large"); return; }
            byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
            if (bytes.length > 20 * 1024 * 1024) { result(id, "null", "File too large"); return; }
            String name = data.optString("name", "hisab.pdf").replaceAll("[\\\\/\\p{Cntrl}]", "_");
            String mime = data.optString("mime", "application/octet-stream");
            if (!mime.matches("[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+")) mime = "application/octet-stream";
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(mime).putExtra(Intent.EXTRA_TITLE, name);
            pendingId = id;
            pendingData = bytes;
            try { startActivityForResult(intent, SAVE); }
            catch (Exception ex) { pendingId = null; pendingData = null; result(id, "null", "File picker unavailable"); }
        }
    }
    @Override protected void onActivityResult(int request, int status, Intent data) {
        super.onActivityResult(request, status, data);
        if (request != CONTACT && request != SAVE) return;
        String id = pendingId;
        byte[] bytes = pendingData;
        pendingId = null; pendingData = null;
        if (id == null) return;
        if (status != RESULT_OK || data == null || data.getData() == null) {
            result(id, request == CONTACT ? "[]" : "false", null); return;
        }
        try {
            if (request == CONTACT) {
                try (Cursor c = getContentResolver().query(data.getData(),
                    new String[]{ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER},
                    null, null, null)) {
                    JSONArray contacts = new JSONArray();
                    if (c != null && c.moveToFirst()) contacts.put(new JSONObject()
                        .put("name", new JSONArray().put(c.getString(0)))
                        .put("tel", new JSONArray().put(c.getString(1))));
                    result(id, contacts.toString(), null);
                }
            } else {
                if (bytes == null) throw new IllegalStateException("File no longer available");
                try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                    if (out == null) throw new IllegalStateException("No output stream");
                    out.write(bytes);
                }
                result(id, "true", null);
                toast(R.string.saved);
            }
        } catch (Exception ex) { result(id, "null", "Could not complete operation"); toast(R.string.save_failed); }
    }
    private void result(String id, String value, String err) {
        if (web.getUrl() == null || !trusted(Uri.parse(web.getUrl()))) return;
        web.evaluateJavascript("window.__tractorResult && window.__tractorResult(" +
            JSONObject.quote(id) + "," + value + "," + (err == null ? "null" : JSONObject.quote(err)) + ")", null);
    }
    private void external(Uri uri) {
        String scheme = uri.getScheme();
        if (!("https".equals(scheme) || "http".equals(scheme) || "tel".equals(scheme) ||
            "mailto".equals(scheme) || "whatsapp".equals(scheme) || "upi".equals(scheme))) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (Exception ex) { toast(R.string.no_handler); }
    }
    private void toast(int resource) { Toast.makeText(this, resource, Toast.LENGTH_LONG).show(); }
    @Override public void onBackPressed() {
        web.evaluateJavascript("(() => { const close = document.querySelector('#layer [data-close]');" +
            "if (close) { close.click(); return true; }" +
            "if (typeof S !== 'undefined' && typeof go === 'function' && S.mode === 'owner' && S.view.name !== 'home')" +
            "{ go('home'); return true; } return false; })()", handled -> {
                if ("true".equals(handled)) return;
                if (web.canGoBack()) web.goBack(); else super.onBackPressed();
            });
    }
    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override protected void onPause() { super.onPause(); web.onPause(); CookieManager.getInstance().flush(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onDestroy() { web.destroy(); super.onDestroy(); }
}
