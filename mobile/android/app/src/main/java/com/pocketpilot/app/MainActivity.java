package com.pocketpilot.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import androidx.core.content.FileProvider;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileOutputStream;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Android's WebView has no Web Share API, so the web app calls this to open the system share sheet.
        bridge.getWebView().addJavascriptInterface(new ShareBridge(), "PocketFinanceApp");
    }

    class ShareBridge {
        @JavascriptInterface
        public boolean canShare() { return true; }

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
