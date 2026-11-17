// Copy this file to server-default.js (git-ignored) and put your own server address in it before building the APK,
// e.g. your `tailscale serve` https address. The app tries it right after the last server that worked,
// before searching the Wi-Fi.
window.PF_DEFAULT_URL = 'https://your-pc.your-tailnet.ts.net:10443';
