import SwiftUI
import WebKit

/// Custom URL scheme `app://` so the bundled React app loads with a real
/// origin (`app://localhost`) instead of `file://`. WKWebView refuses to
/// execute `<script type="module">` over `file://` — this scheme handler
/// is the standard fix and the path Apple recommends for hybrid apps.
///
/// Origin sent on cross-origin fetches: `app://localhost`. The backend
/// CORS allow-list includes this string.
final class WebBundleSchemeHandler: NSObject, WKURLSchemeHandler {
    private let webRoot: URL

    init(webRoot: URL) {
        self.webRoot = webRoot
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        var path = url.path
        if path.hasPrefix("/") { path = String(path.dropFirst()) }
        if path.isEmpty { path = "index.html" }

        let fileURL = webRoot.appendingPathComponent(path)
        do {
            let data = try Data(contentsOf: fileURL)
            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: [
                    "Content-Type": Self.mimeType(for: fileURL),
                    "Content-Length": "\(data.count)",
                ]
            )!
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            print("[WebScheme] failed to serve \(fileURL.path): \(error)")
            let response = HTTPURLResponse(
                url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: [:]
            )!
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didFinish()
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // No async work to cancel.
    }

    private static func mimeType(for url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "application/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "wasm": return "application/wasm"
        case "ico": return "image/x-icon"
        case "map": return "application/json"
        default: return "application/octet-stream"
        }
    }
}

/// The Xcode Run Script "Bundle React frontend" copies `frontend/dist/*`
/// into `<App>.app/web/` on every build. The scheme handler reads from
/// here.
private func bundledWebRoot() -> URL {
    Bundle.main.bundleURL.appendingPathComponent("web", isDirectory: true)
}

private let appURL = URL(string: "app://localhost/index.html")!

struct ContentView: View {
    var body: some View {
        WebView()
            .ignoresSafeArea()
    }
}

struct WebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        print("[ContentView] makeUIView — building WKWebView with bridge")
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        // Allow Web Audio API + audio elements to play without an explicit
        // "user-tap-the-play-button" gesture. Stone-placement sounds still
        // resume the AudioContext from inside the tap handler (per iOS Web
        // Audio rules), but without this, WKWebView blocks audio entirely
        // even when the gesture happens. Empty set = no media type requires
        // explicit user action.
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.javaScriptCanOpenWindowsAutomatically = false

        // Register the custom scheme handler before creating the WKWebView.
        let webRoot = bundledWebRoot()
        if !FileManager.default.fileExists(atPath: webRoot.appendingPathComponent("index.html").path) {
            fatalError("Bundled web/index.html not found at \(webRoot.path) — Run Script 'Bundle React frontend' didn't run")
        }
        config.setURLSchemeHandler(WebBundleSchemeHandler(webRoot: webRoot), forURLScheme: "app")

        let instrumentedShim = KataGoJSShim.source + """

        try {
          window.webkit.messageHandlers.katago.postMessage({ id: 0, cmd: 'ping', params: {} });
          console.log('[Shim] window.kataGo installed, sent ping');
        } catch (e) {
          console.error('[Shim] failed to post initial ping:', e);
        }
        """
        let userScript = WKUserScript(
            source: instrumentedShim,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(userScript)

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.scrollView.bounces = false
        webView.scrollView.isScrollEnabled = false
        webView.allowsBackForwardNavigationGestures = false
        webView.isInspectable = true
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.isOpaque = false

        KataGoBridge.shared.attach(to: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if webView.url == nil {
            // Load via custom `app://` scheme — gives the page a real origin
            // (`app://localhost`) so ES modules work and CORS has a stable
            // origin to allow.
            webView.load(URLRequest(url: appURL))
        }
    }
}
