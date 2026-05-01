import SwiftUI
import WebKit

private let webAppURL = URL(string: "https://goforkids-web.onrender.com/#/")!

struct ContentView: View {
    var body: some View {
        WebView(url: webAppURL)
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
            webView.load(URLRequest(url: url))
        }
    }
}
