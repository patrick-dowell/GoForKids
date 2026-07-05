import Foundation
import WebKit
import UIKit

final class KataGoBridge: NSObject, WKScriptMessageHandler {
    static let shared = KataGoBridge()

    private weak var webView: WKWebView?
    private let workQueue = DispatchQueue(label: "com.goforkids.katago.bridge")
    private var enginePumpStarted = false
    /// Monotonic counter so [perf] log lines can be cross-referenced with JS
    /// and grepped per-call. Reset on engine restart (not on new game).
    private var analyzeCallCount = 0

    func attach(to webView: WKWebView) {
        print("[Bridge] attach() called — registering 'katago' handler + starting engine")
        self.webView = webView
        webView.configuration.userContentController.add(self, name: "katago")
        startEngineIfNeeded()
    }

    private func startEngineIfNeeded() {
        guard !enginePumpStarted else {
            print("[Bridge] Engine already started, skipping")
            return
        }
        enginePumpStarted = true
        print("[Bridge] Spawning KataGo GTP thread")
        Thread {
            KataGoHelper.runGtp()
            print("[Bridge] KataGoHelper.runGtp() returned (engine exited)")
        }.start()
    }

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        print("[Bridge] Received message from JS: \(message.body)")
        guard let body = message.body as? [String: Any],
              let id = body["id"] as? Int,
              let cmd = body["cmd"] as? String else {
            print("[Bridge] Malformed message, ignoring")
            return
        }
        let params = (body["params"] as? [String: Any]) ?? [:]
        workQueue.async { [weak self] in
            guard let self else { return }
            do {
                let result = try self.handle(cmd: cmd, params: params)
                self.respond(id: id, result: result, error: nil)
            } catch {
                print("[Bridge] Error handling cmd '\(cmd)': \(error)")
                self.respond(id: id, result: nil, error: "\(error)")
            }
        }
    }

    private func handle(cmd: String, params: [String: Any]) throws -> [String: Any] {
        switch cmd {
        case "analyze":
            return try analyze(params: params)
        case "ping":
            return ["pong": true]
        case "shareSGF":
            return shareSGF(params: params)
        case "log":
            // Diagnostic: print JS console / errors into Xcode console.
            let level = (params["level"] as? String) ?? "log"
            let msg = (params["msg"] as? String) ?? ""
            print("[JS \(level)] \(msg)")
            return ["ok": true]
        default:
            throw BridgeError.unknownCommand(cmd)
        }
    }

    /// Run KataGo analysis on a position and return ALL candidates with their
    /// per-move stats (visits, winrate, prior, scoreLead, order). The frontend's
    /// rank-calibrated selector (frontend/src/ai/moveSelector.ts) consumes this
    /// list and applies bot-rank logic — the bridge is intentionally dumb.
    private func analyze(params: [String: Any]) throws -> [String: Any] {
        guard let boardSize = params["boardSize"] as? Int,
              let komi = params["komi"] as? Double,
              let moves = params["moves"] as? [[String: String]],
              let color = params["color"] as? String,
              let maxVisits = params["maxVisits"] as? Int else {
            throw BridgeError.invalidParams
        }
        let rules = (params["rules"] as? String) ?? "tromp-taylor"
        // Phase D commit 2: optional ownership mode for end-of-game scoring.
        // When true, append `ownership true` to kata-genmove_analyze and
        // parse the ownership floats from the trailing tokens of each info
        // line. KataGo emits them in row-major order, value in [-1,+1] from
        // Black's perspective (positive = Black controls).
        let includeOwnership = (params["ownership"] as? Bool) ?? false
        analyzeCallCount += 1
        let callId = analyzeCallCount
        print("[Bridge] analyze: boardSize=\(boardSize) komi=\(komi) rules=\(rules) moves=\(moves.count) color=\(color) maxVisits=\(maxVisits)")

        // [perf] Granular timing — see DEVJOURNAL for what each segment means.
        // setup = clear_board + boardsize + komi + set-rules (fixed cost)
        // replay = per-move `play X Y` loop (scales with moves.count)
        // setParam = kata-set-param maxVisits + maxTime
        // ttfi = send `kata-genmove_analyze` → first `info` line back (per-call
        //        engine spin-up: tree init, weight paging, ANE handoff)
        // search = first info line → `play` line (the actual visits)
        // parse = result sorting + score flip after engine returns
        let tStart = Date()
        gtp("clear_board")
        gtp("boardsize \(boardSize)")
        gtp("komi \(komi)")
        gtp("kata-set-rules \(rules)")
        let tAfterSetup = Date()
        for move in moves {
            guard let mc = move["color"], let mp = move["point"] else { continue }
            gtp("play \(mc) \(mp)")
        }
        let tAfterReplay = Date()
        gtp("kata-set-param maxVisits \(maxVisits)")
        // Override the cfg's maxTime cap so we actually use all the visits
        gtp("kata-set-param maxTime 60")
        // §3 out-of-pool (2026-07-05): weak-rung profiles spread root visits
        // across most plausible moves so the candidate list becomes a wide
        // policy sample. ALWAYS set (0.0 = KataGo default off) — the engine
        // is long-lived and must not carry a stale value into settle /
        // finishMove / score analyses, which omit the param.
        let wideRootNoise = (params["wideRootNoise"] as? Double) ?? 0.0
        gtp("kata-set-param wideRootNoise \(wideRootNoise)")
        let tAfterSetParam = Date()

        // kata-genmove_analyze streams `info` lines (one per candidate) then
        // ends with `play <move>`. Parse every info line into a candidate dict.
        let analyzeCmd = includeOwnership
            ? "kata-genmove_analyze \(color) ownership true"
            : "kata-genmove_analyze \(color)"
        KataGoHelper.sendCommand(analyzeCmd)
        var playedMove: String? = nil
        // Keep the LAST info line per move (KataGo emits multiple as the search
        // progresses; later lines have the final visit counts).
        var candidatesByMove: [String: [String: Any]] = [:]
        // Preserve insertion order so we can also report it back; we override
        // it with the explicit `order N` field if present.
        var moveOrder: [String] = []
        var rawLines = 0
        var tFirstInfo: Date? = nil
        // Last-seen ownership row-major flat list. Same data repeats in every
        // info line (root-ownership, computed once per search), so we just
        // overwrite as we go — the final assignment captures the deepest
        // search's ownership estimate.
        var ownershipFlat: [Double]? = nil
        while true {
            let line = KataGoHelper.getMessageLine()
            rawLines += 1
            if line.hasPrefix("play ") {
                playedMove = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("info ") {
                if tFirstInfo == nil { tFirstInfo = Date() }
                // KataGo emits ONE line carrying ALL root moves as
                // concatenated "info move …" segments (kata-genmove_analyze
                // without an interval prints a single final dump). The old
                // code fed the whole line to parseInfoLine, which stops at
                // the first `pv` — so the bridge returned a ONE-candidate
                // pool from Phase D (May) until 2026-07-05, silently forcing
                // every rank profile toward perfect top-move play on-device
                // (§3, DEVJOURNAL S41). Split into per-move segments first.
                for seg in line.components(separatedBy: "info move ").dropFirst() {
                    if let parsed = parseInfoLine("info move " + seg) {
                        if candidatesByMove[parsed["move"] as! String] == nil {
                            moveOrder.append(parsed["move"] as! String)
                        }
                        candidatesByMove[parsed["move"] as! String] = parsed
                    }
                }
                if includeOwnership, let extracted = parseOwnership(line, expectedCount: boardSize * boardSize) {
                    ownershipFlat = extracted
                }
            } else if playedMove != nil && line.isEmpty {
                break
            } else if rawLines > 50000 {
                break  // safety: never spin forever
            }
        }
        let tAfterGenmove = Date()
        let elapsed = tAfterGenmove.timeIntervalSince(tStart)

        // Sort candidates by their explicit `order` field (KataGo's preference,
        // 0 = best). Pass this on so the frontend's selector treats array
        // index 0 as the best candidate, matching the Python's behavior.
        let sortedKeys = moveOrder.sorted { a, b in
            let ao = (candidatesByMove[a]?["order"] as? Int) ?? Int.max
            let bo = (candidatesByMove[b]?["order"] as? Int) ?? Int.max
            return ao < bo
        }

        // Flip scoreLead to black's perspective. KataGo emits it from the
        // side-to-move's perspective; the frontend score graph + selector both
        // expect black's perspective for consistency with GameStateDTO.
        var candidatesOut: [[String: Any]] = []
        for key in sortedKeys {
            guard var cand = candidatesByMove[key] else { continue }
            if let raw = cand["scoreLead"] as? Double {
                cand["scoreLead"] = (color.uppercased() == "B") ? raw : -raw
            }
            candidatesOut.append(cand)
        }

        let tEnd = Date()
        let bestPreview: String = {
            guard let first = candidatesOut.first else { return "—" }
            let mv = (first["move"] as? String) ?? "?"
            let sl = (first["scoreLead"] as? Double).map { String(format: "%.2f", $0) } ?? "—"
            let v = (first["visits"] as? Int).map { String($0) } ?? "?"
            return "\(mv) sl=\(sl) v=\(v)"
        }()
        print("[Bridge] analyze returned \(candidatesOut.count) candidates (best: \(bestPreview)) in \(String(format: "%.2f", elapsed))s")

        // [perf] one-line CSV-ish summary, easy to grep + paste into a sheet.
        // ttfi is "—" if no info lines arrived (shouldn't happen for non-pass).
        func ms(_ a: Date, _ b: Date) -> Int { Int((b.timeIntervalSince(a)) * 1000) }
        let setupMs = ms(tStart, tAfterSetup)
        let replayMs = ms(tAfterSetup, tAfterReplay)
        let setParamMs = ms(tAfterReplay, tAfterSetParam)
        let ttfiMs: String = tFirstInfo.map { String(ms(tAfterSetParam, $0)) } ?? "—"
        let searchMs: String = tFirstInfo.map { String(ms($0, tAfterGenmove)) } ?? String(ms(tAfterSetParam, tAfterGenmove))
        let parseMs = ms(tAfterGenmove, tEnd)
        let totalMs = ms(tStart, tEnd)
        print("[perf] call#\(callId) board=\(boardSize) movesReplayed=\(moves.count) visits=\(maxVisits) setup=\(setupMs)ms replay=\(replayMs)ms setParam=\(setParamMs)ms ttfi=\(ttfiMs)ms search=\(searchMs)ms parse=\(parseMs)ms total=\(totalMs)ms")

        var out: [String: Any] = [
            "candidates": candidatesOut,
            "rootVisits": maxVisits,
            "kataGoPlayedMove": playedMove ?? "",
        ]
        if let ownership = ownershipFlat {
            out["ownership"] = ownership
            print("[Bridge] ownership returned (\(ownership.count) values, first 4: \(ownership.prefix(4)))")
        } else if includeOwnership {
            print("[Bridge] ownership requested but NOT FOUND in info lines — check kata-genmove_analyze syntax")
        }
        return out
    }

    /// Find the trailing `ownership <f0> <f1> ... <fN>` block in an info
    /// line and return the parsed floats. KataGo appends ownership after
    /// `pv` (which has variable-length value), so we can't rely on key/value
    /// pairs — locate the literal " ownership " marker and parse from there.
    /// Returns nil if the marker is absent or float-count != expectedCount.
    private func parseOwnership(_ line: String, expectedCount: Int) -> [Double]? {
        guard let range = line.range(of: " ownership ") else { return nil }
        let tail = line[range.upperBound...]
        let tokens = tail.split(separator: " ", omittingEmptySubsequences: true)
        // Parse contiguous floats from the start of `tail`; stop at the first
        // non-numeric token (in case KataGo appends more fields after).
        var values: [Double] = []
        for tok in tokens {
            guard let v = Double(tok) else { break }
            values.append(v)
        }
        // KataGo emits boardSize² floats. If we got fewer (truncated line)
        // or wildly more, treat as malformed.
        if values.count == expectedCount { return values }
        return nil
    }

    /// Parse a `kata-genmove_analyze` info line like
    /// `info move C4 visits 5 winrate 0.95 ... scoreLead 1.23 prior 0.18 order 0 pv C4 D5 ...`
    /// Stops at the `pv` token (variable-length tail). Returns dict with the
    /// frontend's expected keys; missing fields are simply omitted.
    private func parseInfoLine(_ line: String) -> [String: Any]? {
        let tokens = line.split(separator: " ").map(String.init)
        guard tokens.count >= 4, tokens[0] == "info", tokens[1] == "move" else { return nil }
        var out: [String: Any] = ["move": tokens[2]]
        var i = 3
        while i + 1 < tokens.count {
            let key = tokens[i]
            if key == "pv" { break }  // variable-length tail
            let valTok = tokens[i + 1]
            switch key {
            case "visits", "order":
                if let v = Int(valTok) { out[key] = v }
            case "winrate", "scoreLead", "scoreMean", "scoreStdev", "prior", "utility", "utilityLcb":
                if let v = Double(valTok) { out[key] = v }
            default:
                break  // unknown key; ignore
            }
            i += 2
        }
        return out
    }

    @discardableResult
    private func gtp(_ command: String) -> String {
        KataGoHelper.sendCommand(command)
        let response = readResponse()
        // Truncate long responses so the log isn't a wall of text
        let preview = response.count > 80 ? String(response.prefix(80)) + "…" : response
        print("[Bridge] GTP > \(command)  <  \(preview)")
        return response
    }

    private func readResponse() -> String {
        var firstNonEmpty = ""
        while true {
            let line = KataGoHelper.getMessageLine()
            if firstNonEmpty.isEmpty {
                if line.isEmpty { continue }
                firstNonEmpty = line
            } else if line.isEmpty {
                break
            }
        }
        return firstNonEmpty
    }

    private func respond(id: Int, result: [String: Any]?, error: String?) {
        var payload: [String: Any] = ["id": id]
        if let result { payload["result"] = result }
        if let error { payload["error"] = error }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript("window.__kataGoCallback && window.__kataGoCallback(\(json))")
        }
    }

    enum BridgeError: Error, CustomStringConvertible {
        case unknownCommand(String)
        case invalidParams
        var description: String {
            switch self {
            case .unknownCommand(let c): return "Unknown bridge command: \(c)"
            case .invalidParams: return "Invalid bridge params"
            }
        }
    }
}

extension KataGoBridge {
    /// Present the iOS share sheet for an SGF file (AirDrop / Files / other
    /// Go apps). WKWebView can't do the web's Blob-URL download flow, so the
    /// JS side posts the SGF text here instead (TestFlight bug, 2026-05-14).
    fileprivate func shareSGF(params: [String: Any]) -> [String: Any] {
        guard let sgf = params["sgf"] as? String,
              var filename = params["filename"] as? String else {
            return ["ok": false, "error": "missing sgf/filename"]
        }
        // Keep the filename filesystem-safe.
        filename = filename.replacingOccurrences(of: "/", with: "-")
        if !filename.hasSuffix(".sgf") { filename += ".sgf" }
        DispatchQueue.main.async { [weak self] in
            guard let webView = self?.webView else { return }
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
            do {
                try sgf.write(to: url, atomically: true, encoding: .utf8)
            } catch {
                print("[Bridge] shareSGF: temp write failed: \(error)")
                return
            }
            let activity = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            // iPad requires a popover anchor or UIKit throws.
            if let pop = activity.popoverPresentationController {
                pop.sourceView = webView
                pop.sourceRect = CGRect(x: webView.bounds.midX, y: webView.bounds.midY, width: 1, height: 1)
                pop.permittedArrowDirections = []
            }
            var presenter: UIViewController? = nil
            if let scene = UIApplication.shared.connectedScenes
                .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
                presenter = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController
            }
            while let presented = presenter?.presentedViewController { presenter = presented }
            guard let vc = presenter else {
                print("[Bridge] shareSGF: no presenting view controller")
                return
            }
            vc.present(activity, animated: true)
        }
        return ["ok": true]
    }
}

enum KataGoJSShim {
    static let source: String = """
    (function() {
      if (window.kataGo) return;
      let nextId = 1;
      const pending = new Map();
      window.__kataGoCallback = function(payload) {
        const cb = pending.get(payload.id);
        if (!cb) return;
        pending.delete(payload.id);
        if (payload.error) cb.reject(new Error(payload.error));
        else cb.resolve(payload.result);
      };
      function call(cmd, params) {
        return new Promise((resolve, reject) => {
          const id = nextId++;
          pending.set(id, { resolve, reject });
          window.webkit.messageHandlers.katago.postMessage({ id, cmd, params });
        });
      }
      window.kataGo = {
        ping: () => call('ping', {}),
        analyze: (params) => call('analyze', params),
        shareSGF: (params) => call('shareSGF', params)
      };

      // --- Diagnostic console / error interceptor ---------------------------
      // Routes window.onerror, unhandled rejections, and console.{log,info,
      // warn,error} through the bridge so they show up in Xcode console with
      // a [JS <level>] prefix. Without this we have zero visibility into JS
      // failures unless Web Inspector is attached.
      function postLog(level, args) {
        try {
          var msg = Array.prototype.map.call(args, function(a) {
            if (a instanceof Error) return a.stack || (a.name + ': ' + a.message);
            if (typeof a === 'object') {
              try { return JSON.stringify(a); } catch (e) { return String(a); }
            }
            return String(a);
          }).join(' ');
          window.webkit.messageHandlers.katago.postMessage({
            id: nextId++,
            cmd: 'log',
            params: { level: level, msg: msg }
          });
        } catch (e) {
          // last-resort: bridge unavailable — nothing we can do.
        }
      }
      var origLog = console.log, origInfo = console.info, origWarn = console.warn, origErr = console.error;
      console.log = function() { postLog('log', arguments); origLog.apply(console, arguments); };
      console.info = function() { postLog('info', arguments); origInfo.apply(console, arguments); };
      console.warn = function() { postLog('warn', arguments); origWarn.apply(console, arguments); };
      console.error = function() { postLog('error', arguments); origErr.apply(console, arguments); };
      window.addEventListener('error', function(e) {
        // Capture script load failures (e.target is the failing script/link).
        if (e.target && (e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK')) {
          postLog('error', ['resource load failed:', e.target.tagName, e.target.src || e.target.href]);
        } else {
          postLog('error', ['window.error:', e.message, 'at', e.filename + ':' + e.lineno + ':' + e.colno]);
        }
      }, true);  // capture-phase: catches script/link load failures that don't bubble
      window.addEventListener('unhandledrejection', function(e) {
        postLog('error', ['unhandled rejection:', e.reason && (e.reason.stack || e.reason.message || e.reason)]);
      });
      // After 2s, dump page state — catches "silent script never executed".
      setTimeout(function() {
        var rootEl = document.getElementById('root');
        var rootChildren = rootEl ? rootEl.children.length : -1;
        var scripts = [];
        for (var i = 0; i < document.scripts.length; i++) {
          var s = document.scripts[i];
          scripts.push((s.src || '<inline>') + ' type=' + (s.type || ''));
        }
        var styles = [];
        var ssLinks = document.querySelectorAll('link[rel="stylesheet"]');
        for (var j = 0; j < ssLinks.length; j++) styles.push(ssLinks[j].href);
        postLog('log', ['[diag@2s] location=' + location.href]);
        postLog('log', ['[diag@2s] document.readyState=' + document.readyState + ' #root.children=' + rootChildren]);
        postLog('log', ['[diag@2s] scripts=' + JSON.stringify(scripts)]);
        postLog('log', ['[diag@2s] stylesheets=' + JSON.stringify(styles)]);
      }, 2000);
    })();
    """
}
