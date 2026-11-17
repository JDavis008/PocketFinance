package com.pocketpilot.app;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Base64;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileOutputStream;

public class MainActivity extends BridgeActivity {
    private static final long RELOCK_AFTER_MS = 60_000;
    private SharedPreferences prefs;
    private View lockView;
    private long hiddenAt = -1; // -1 = app just started

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("pocketfinance", MODE_PRIVATE);
        // Android's WebView has no Web Share API, so the web app calls these through window.PocketFinanceApp.
        bridge.getWebView().addJavascriptInterface(new AppBridge(), "PocketFinanceApp");

        // Back goes to the previous page in PocketFinance; on the first page it sends the app to the background.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = bridge.getWebView();
                if (lockView == null && web != null && web.canGoBack()) web.goBack();
                else moveTaskToBack(true);
            }
        });
    }

    @Override
    public void onStart() {
        super.onStart();
        boolean away = hiddenAt < 0 || SystemClock.elapsedRealtime() - hiddenAt > RELOCK_AFTER_MS;
        if (lockEnabled() && away) showLock();
    }

    @Override
    public void onPause() {
        super.onPause();
        CookieManager.getInstance().flush(); // keep the sign-in even if Android closes the app right away
    }

    @Override
    public void onStop() {
        super.onStop();
        hiddenAt = SystemClock.elapsedRealtime();
    }

    // ---------- app lock (fingerprint / face / phone PIN) ----------
    private boolean lockEnabled() { return prefs.getBoolean("lock", false) && lockAvailable(); }

    private boolean lockAvailable() {
        if (Build.VERSION.SDK_INT >= 30) {
            return BiometricManager.from(this).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL) == BiometricManager.BIOMETRIC_SUCCESS;
        }
        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        return km != null && km.isDeviceSecure();
    }

    private int dp(int v) { return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()); }

    private void showLock() {
        if (lockView == null) {
            LinearLayout box = new LinearLayout(this);
            box.setOrientation(LinearLayout.VERTICAL);
            box.setGravity(Gravity.CENTER);
            box.setBackgroundColor(Color.parseColor("#090a12"));
            box.setClickable(true); // blocks touches to the page underneath
            ImageView logo = new ImageView(this);
            logo.setImageResource(R.mipmap.ic_launcher);
            box.addView(logo, new LinearLayout.LayoutParams(dp(84), dp(84)));
            TextView title = new TextView(this);
            title.setText("PocketFinance is locked");
            title.setTextColor(Color.parseColor("#eef0f8"));
            title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
            title.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            title.setGravity(Gravity.CENTER);
            title.setPadding(dp(24), dp(20), dp(24), dp(6));
            box.addView(title, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            TextView hint = new TextView(this);
            hint.setText("Use your fingerprint, face or screen lock");
            hint.setTextColor(Color.parseColor("#8b90a8"));
            hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            hint.setGravity(Gravity.CENTER);
            hint.setPadding(dp(24), 0, dp(24), dp(24));
            box.addView(hint, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            Button unlock = new Button(this);
            unlock.setText("Unlock");
            unlock.setAllCaps(false);
            unlock.setTextColor(Color.WHITE);
            unlock.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
            unlock.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.TL_BR, new int[] { Color.parseColor("#6d4aff"), Color.parseColor("#4f46e5"), Color.parseColor("#0ea5e9") });
            bg.setCornerRadius(dp(14));
            unlock.setBackground(bg);
            unlock.setStateListAnimator(null);
            unlock.setOnClickListener(v -> askToUnlock());
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(220), dp(52));
            box.addView(unlock, lp);
            lockView = box;
            addContentView(lockView, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        lockView.bringToFront();
        // no keyboard over the lock screen (a text box in the page may still have focus)
        android.view.inputmethod.InputMethodManager imm = (android.view.inputmethod.InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null) imm.hideSoftInputFromWindow(lockView.getWindowToken(), 0);
        if (bridge.getWebView() != null) bridge.getWebView().clearFocus();
        askToUnlock();
    }

    private void unlocked() {
        if (lockView != null) { ((ViewGroup) lockView.getParent()).removeView(lockView); lockView = null; }
    }

    private void askToUnlock() {
        if (!lockAvailable()) { unlocked(); return; } // screen lock was removed from the phone
        BiometricPrompt prompt = new BiometricPrompt(this, ContextCompat.getMainExecutor(this), new BiometricPrompt.AuthenticationCallback() {
            @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) { unlocked(); }
        });
        BiometricPrompt.PromptInfo.Builder info = new BiometricPrompt.PromptInfo.Builder()
            .setTitle("Unlock PocketFinance")
            .setSubtitle("Use your fingerprint, face or screen lock");
        if (Build.VERSION.SDK_INT >= 30) info.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL);
        else info.setDeviceCredentialAllowed(true);
        prompt.authenticate(info.build());
    }

    class AppBridge {
        @JavascriptInterface
        public boolean canShare() { return true; }

        @JavascriptInterface
        public String version() { try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return ""; } }

        // device key per server (see /api/auth/device), so the app signs itself in
        private boolean okServer(String id) { return id != null && id.matches("[a-f0-9]{8,64}"); }

        @JavascriptInterface
        public String getToken(String server) { return okServer(server) ? prefs.getString("token:" + server, "") : ""; }

        @JavascriptInterface
        public void saveToken(String server, String token) {
            if (okServer(server) && token != null && token.matches("[a-f0-9]{64}")) prefs.edit().putString("token:" + server, token).apply();
        }

        @JavascriptInterface
        public void clearToken(String server) { if (okServer(server)) prefs.edit().remove("token:" + server).apply(); }

        @JavascriptInterface
        public String deviceName() {
            String m = Build.MODEL == null ? "" : Build.MODEL;
            String b = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER;
            String n = m.toLowerCase().startsWith(b.toLowerCase()) ? m : (b.isEmpty() ? m : b.substring(0, 1).toUpperCase() + b.substring(1) + " " + m);
            return n.isEmpty() ? "Android phone" : n;
        }

        @JavascriptInterface
        public boolean lockAvailable() { return MainActivity.this.lockAvailable(); }

        @JavascriptInterface
        public boolean getLock() { return prefs.getBoolean("lock", false); }

        @JavascriptInterface
        public void setLock(boolean on) { prefs.edit().putBoolean("lock", on).apply(); }

        @JavascriptInterface
        public void lockNow() { runOnUiThread(() -> { if (lockEnabled()) showLock(); }); }

        /** Back to the connect screen to pick another PocketFinance server. */
        @JavascriptInterface
        public void switchServer() { runOnUiThread(() -> bridge.getWebView().loadUrl(bridge.getLocalUrl() + "/?pick=1")); }

        /** The phone's private IPv4 addresses (Wi-Fi first), comma-separated, so the launcher can search the home network. */
        @JavascriptInterface
        public String localIps() {
            java.util.List<String> wifi = new java.util.ArrayList<>(), other = new java.util.ArrayList<>();
            try {
                for (java.net.NetworkInterface ni : java.util.Collections.list(java.net.NetworkInterface.getNetworkInterfaces())) {
                    if (!ni.isUp() || ni.isLoopback()) continue;
                    for (java.net.InetAddress a : java.util.Collections.list(ni.getInetAddresses())) {
                        if (!(a instanceof java.net.Inet4Address) || !a.isSiteLocalAddress()) continue;
                        (ni.getName().startsWith("wlan") || ni.getName().startsWith("eth") ? wifi : other).add(a.getHostAddress());
                    }
                }
            } catch (Exception ignored) { }
            wifi.addAll(other);
            return String.join(",", wifi);
        }

        /** Opens the share sheet with text and, optionally, a PNG image (base64, no data: prefix). */
        @JavascriptInterface
        public void share(String title, String text, String pngBase64) {
            runOnUiThread(() -> {
                try {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    if (text != null && !text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
                    if (title != null && !title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);
                    if (pngBase64 != null && !pngBase64.isEmpty() && pngBase64.length() < 12_000_000) {
                        byte[] png = Base64.decode(pngBase64, Base64.DEFAULT);
                        File dir = new File(getCacheDir(), "share");
                        dir.mkdirs();
                        File[] old = dir.listFiles();
                        if (old != null) for (File f : old) f.delete();
                        File out = new File(dir, "PocketFinance-" + System.currentTimeMillis() + ".png");
                        try (FileOutputStream fo = new FileOutputStream(out)) { fo.write(png); }
                        Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", out);
                        send.setType("image/png");
                        send.putExtra(Intent.EXTRA_STREAM, uri);
                        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    } else {
                        send.setType("text/plain");
                    }
                    startActivity(Intent.createChooser(send, title == null || title.isEmpty() ? "Share" : title));
                } catch (Exception e) {
                    android.util.Log.e("PocketFinance", "share failed", e);
                }
            });
        }
    }
}
