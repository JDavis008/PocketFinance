import UIKit
import WebKit
import Capacitor

/// Same native helpers as the Android app's MainActivity, exposed to the web pages as `window.PocketFinanceApp`:
///  - localIps(): the phone's Wi-Fi IPv4 address(es), so the launcher can search the home network for the server
///  - share(title, text, pngBase64): the iOS share sheet (used by the 📤 button in the web app)
class MainViewController: CAPBridgeViewController, WKScriptMessageHandler {

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        guard let controller = webView?.configuration.userContentController else { return }
        controller.add(WeakMessageHandler(self), name: "pfShare")
        let ips = MainViewController.localIps().joined(separator: ",") // digits, dots and commas only
        let js = """
        window.PocketFinanceApp = {
          canShare: function () { return true; },
          localIps: function () { return '\(ips)'; },
          share: function (title, text, png) {
            window.webkit.messageHandlers.pfShare.postMessage({ title: title || '', text: text || '', png: png || '' });
          }
        };
        """
        controller.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "pfShare", let body = message.body as? [String: Any] else { return }
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
