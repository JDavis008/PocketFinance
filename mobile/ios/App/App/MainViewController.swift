import UIKit
import WebKit
import LocalAuthentication
import Capacitor

/// Same native helpers as the Android app's MainActivity, exposed to the web pages as `window.PocketFinanceApp`:
///  - localIps(): the phone's Wi-Fi IPv4 address(es), so the launcher can search the home network for the server
///  - share(title, text, pngBase64): the iOS share sheet (used by the 📤 button in the web app)
///  - lockAvailable() / getLock() / setLock(on) / lockNow(): Face ID, Touch ID or passcode lock
///  - switchServer(): back to the connect screen;  version(): app version
class MainViewController: CAPBridgeViewController, WKScriptMessageHandler {
    private static let relockAfter: TimeInterval = 60
    private var lockView: UIView?
    private var hiddenAt: Date?
    private var lockEnabled: Bool { UserDefaults.standard.bool(forKey: "pf.lock") && MainViewController.lockAvailable() }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        guard let controller = webView?.configuration.userContentController else { return }
        controller.add(WeakMessageHandler(self), name: "pfShare")
        controller.add(WeakMessageHandler(self), name: "pfApp")
        let ips = MainViewController.localIps().joined(separator: ",") // digits, dots and commas only
        let version = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "").filter { $0.isNumber || $0 == "." }
        // device keys per server id (see /api/auth/device) so the app signs itself in; only hex, safe to inline
        let tokens = (UserDefaults.standard.dictionary(forKey: "pf.tokens") as? [String: String] ?? [:])
            .filter { MainViewController.isHex($0.key, 8...64) && MainViewController.isHex($0.value, 64...64) }
        let tokenJs = "{" + tokens.map { "'\($0.key)':'\($0.value)'" }.joined(separator: ",") + "}"
        let device = UIDevice.current.model.filter { $0.isLetter || $0.isNumber || $0 == " " }
        let js = """
        window.PocketFinanceApp = {
          _t: \(tokenJs),
          getToken: function (id) { return this._t[id] || ''; },
          saveToken: function (id, t) { this._t[id] = t; window.webkit.messageHandlers.pfApp.postMessage({ cmd: 'saveToken', id: id, token: t }); },
          clearToken: function (id) { delete this._t[id]; window.webkit.messageHandlers.pfApp.postMessage({ cmd: 'clearToken', id: id }); },
          deviceName: function () { return '\(device)'; },
          canShare: function () { return true; },
          version: function () { return '\(version)'; },
          localIps: function () { return '\(ips)'; },
          lockAvailable: function () { return \(MainViewController.lockAvailable() ? "true" : "false"); },
          getLock: function () { try { var v = localStorage.getItem('pf-lock'); if (v !== null) return v === '1'; } catch (e) {} return \(UserDefaults.standard.bool(forKey: "pf.lock") ? "true" : "false"); },
          setLock: function (on) { try { localStorage.setItem('pf-lock', on ? '1' : '0'); } catch (e) {} window.webkit.messageHandlers.pfApp.postMessage({ cmd: 'setLock', on: !!on }); },
          lockNow: function () { window.webkit.messageHandlers.pfApp.postMessage({ cmd: 'lockNow' }); },
          switchServer: function () { window.webkit.messageHandlers.pfApp.postMessage({ cmd: 'switchServer' }); },
          share: function (title, text, png) {
            window.webkit.messageHandlers.pfShare.postMessage({ title: title || '', text: text || '', png: png || '' });
          }
        };
        """
        controller.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(willEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
        if lockEnabled { DispatchQueue.main.async { self.showLock(prompt: true) } }
    }

    // ---------- lock ----------
    static func lockAvailable() -> Bool { LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) }

    @objc private func didEnterBackground() {
        hiddenAt = Date()
        if lockEnabled { showLock(prompt: false) } // also hides your numbers in the app switcher
    }

    @objc private func willEnterForeground() {
        guard lockView != nil else { return }
        if let at = hiddenAt, Date().timeIntervalSince(at) < MainViewController.relockAfter { removeLock() } else { askToUnlock() }
    }

    private func showLock(prompt: Bool) {
        if lockView == nil {
            let cover = UIView(frame: view.bounds)
            cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            cover.backgroundColor = UIColor(red: 9 / 255, green: 10 / 255, blue: 18 / 255, alpha: 1)
            let title = UILabel()
            title.text = "PocketFinance is locked"
            title.textColor = UIColor(red: 238 / 255, green: 240 / 255, blue: 248 / 255, alpha: 1)
            title.font = .systemFont(ofSize: 20, weight: .semibold)
            let button = UIButton(type: .system)
            button.setTitle("Unlock", for: .normal)
            button.titleLabel?.font = .systemFont(ofSize: 18, weight: .bold)
            button.addTarget(self, action: #selector(unlockTapped), for: .touchUpInside)
            let stack = UIStackView(arrangedSubviews: [title, button])
            stack.axis = .vertical; stack.alignment = .center; stack.spacing = 18
            stack.translatesAutoresizingMaskIntoConstraints = false
            cover.addSubview(stack)
            NSLayoutConstraint.activate([stack.centerXAnchor.constraint(equalTo: cover.centerXAnchor), stack.centerYAnchor.constraint(equalTo: cover.centerYAnchor)])
            view.addSubview(cover)
            lockView = cover
        }
        if let cover = lockView { view.bringSubviewToFront(cover) }
        if prompt { askToUnlock() }
    }

    @objc private func unlockTapped() { askToUnlock() }

    private func removeLock() { lockView?.removeFromSuperview(); lockView = nil }

    private func askToUnlock() {
        guard MainViewController.lockAvailable() else { removeLock(); return } // passcode was turned off on the phone
        LAContext().evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock PocketFinance") { ok, _ in
            DispatchQueue.main.async { if ok { self.removeLock() } }
        }
    }

    // ---------- messages from the page ----------
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        if message.name == "pfApp" {
            switch body["cmd"] as? String {
            case "setLock": UserDefaults.standard.set(body["on"] as? Bool ?? false, forKey: "pf.lock")
            case "lockNow": if lockEnabled { showLock(prompt: true) }
            case "saveToken", "clearToken":
                guard let id = body["id"] as? String, MainViewController.isHex(id, 8...64) else { return }
                var tokens = UserDefaults.standard.dictionary(forKey: "pf.tokens") as? [String: String] ?? [:]
                if body["cmd"] as? String == "saveToken", let t = body["token"] as? String, MainViewController.isHex(t, 64...64) { tokens[id] = t } else { tokens.removeValue(forKey: id) }
                UserDefaults.standard.set(tokens, forKey: "pf.tokens")
            case "switchServer":
                if let local = bridge?.config.localURL, let url = URL(string: local.absoluteString + "/?pick=1") { webView?.load(URLRequest(url: url)) }
            default: break
            }
            return
        }
        guard message.name == "pfShare" else { return }
        var items: [Any] = []
        if let text = body["text"] as? String, !text.isEmpty { items.append(text) }
        if let png = body["png"] as? String, !png.isEmpty, png.count < 12_000_000,
           let data = Data(base64Encoded: png, options: .ignoreUnknownCharacters), let image = UIImage(data: data) {
            items.append(image)
        }
        guard !items.isEmpty else { return }
        let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
        if let title = body["title"] as? String, !title.isEmpty { sheet.setValue(title, forKey: "subject") }
        if let pop = sheet.popoverPresentationController { // iPad
            pop.sourceView = view
            pop.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.maxY - 80, width: 1, height: 1)
            pop.permittedArrowDirections = []
        }
        present(sheet, animated: true)
    }

    static func isHex(_ s: String, _ len: ClosedRange<Int>) -> Bool {
        len.contains(s.count) && s.allSatisfy { ("0"..."9").contains($0) || ("a"..."f").contains($0) }
    }

    /// Private IPv4 addresses on the Wi-Fi / Ethernet interfaces (en0, en1…). Cellular and VPN addresses are left out.
    static func localIps() -> [String] {
        var result: [String] = []
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return [] }
        defer { freeifaddrs(ifaddr) }
        for ptr in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let ifa = ptr.pointee
            guard let addr = ifa.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET) else { continue }
            let flags = Int32(ifa.ifa_flags)
            guard (flags & IFF_UP) != 0, (flags & IFF_LOOPBACK) == 0 else { continue }
            guard String(cString: ifa.ifa_name).hasPrefix("en") else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            guard getnameinfo(addr, socklen_t(addr.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 else { continue }
            let ip = String(cString: host)
            let parts = ip.split(separator: ".").compactMap { Int($0) }
            guard parts.count == 4 else { continue }
            let isPrivate = parts[0] == 10 || (parts[0] == 192 && parts[1] == 168) || (parts[0] == 172 && (16...31).contains(parts[1]))
            if isPrivate && !result.contains(ip) { result.append(ip) }
        }
        return result
    }
}

/// WKUserContentController keeps a strong reference to its handlers; this avoids a retain cycle with the view controller.
private class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
