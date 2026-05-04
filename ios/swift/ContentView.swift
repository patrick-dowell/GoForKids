import SwiftUI
import WebKit

/// Locate the bundled React frontend. The Xcode Run Script "Bundle React
/// frontend" copies `frontend/dist/*` into `<App>.app/web/` on every build.
/// If you see this fatalError, that build phase didn't run — check the
/// Build Phases tab and the iOS README.
private func bundledIndexURL() -> URL {
    if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") {
        return url
    }
    fatalError("Bundled web/index.html not found — Run Script 'Bundle React frontend' didn't run")
}

struct ContentView: View {
    var body: some View {
        WebView(url: bundledIndexURL())
            .ignoresSafeArea()
    }
}

struct WebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        print("[ContentView] makeUIView — building WKWebView with bridge")
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.preferences.javaScriptCanOpenWindowsAutomatically = false

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
            // Phase 3: load bundled index.html via file://. Grant read access
            // to the entire web/ directory so JS, CSS, and assets resolve.
            // fetch() calls to the Render API will appear as Origin: null,
            // which the backend's CORS allow-list must include.
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
    }
}
