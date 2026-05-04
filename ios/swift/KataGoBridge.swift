import Foundation
import WebKit

final class KataGoBridge: NSObject, WKScriptMessageHandler {
    static let shared = KataGoBridge()

    private weak var webView: WKWebView?
    private let workQueue = DispatchQueue(label: "com.goforkids.katago.bridge")
    private var enginePumpStarted = false

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
        print("[Bridge] analyze: boardSize=\(boardSize) komi=\(komi) rules=\(rules) moves=\(moves.count) color=\(color) maxVisits=\(maxVisits)")

        let startTime = Date()
        gtp("clear_board")
        gtp("boardsize \(boardSize)")
        gtp("komi \(komi)")
        gtp("kata-set-rules \(rules)")
        for move in moves {
            guard let mc = move["color"], let mp = move["point"] else { continue }
            gtp("play \(mc) \(mp)")
        }
        gtp("kata-set-param maxVisits \(maxVisits)")
        // Override the cfg's maxTime cap so we actually use all the visits
        gtp("kata-set-param maxTime 60")

        // kata-genmove_analyze streams `info` lines (one per candidate) then
        // ends with `play <move>`. Parse every info line into a candidate dict.
        KataGoHelper.sendCommand("kata-genmove_analyze \(color)")
        var playedMove: String? = nil
        // Keep the LAST info line per move (KataGo emits multiple as the search
        // progresses; later lines have the final visit counts).
        var candidatesByMove: [String: [String: Any]] = [:]
        // Preserve insertion order so we can also report it back; we override
        // it with the explicit `order N` field if present.
        var moveOrder: [String] = []
        var rawLines = 0
        while true {
            let line = KataGoHelper.getMessageLine()
            rawLines += 1
            if line.hasPrefix("play ") {
                playedMove = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("info ") {
                if let parsed = parseInfoLine(line) {
                    if candidatesByMove[parsed["move"] as! String] == nil {
                        moveOrder.append(parsed["move"] as! String)
                    }
                    candidatesByMove[parsed["move"] as! String] = parsed
                }
            } else if playedMove != nil && line.isEmpty {
                break
            } else if rawLines > 50000 {
                break  // safety: never spin forever
            }
        }
        let elapsed = Date().timeIntervalSince(startTime)

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

        let bestPreview: String = {
            guard let first = candidatesOut.first else { return "—" }
            let mv = (first["move"] as? String) ?? "?"
            let sl = (first["scoreLead"] as? Double).map { String(format: "%.2f", $0) } ?? "—"
            let v = (first["visits"] as? Int).map { String($0) } ?? "?"
            return "\(mv) sl=\(sl) v=\(v)"
        }()
        print("[Bridge] analyze returned \(candidatesOut.count) candidates (best: \(bestPreview)) in \(String(format: "%.2f", elapsed))s")

        return [
            "candidates": candidatesOut,
            "rootVisits": maxVisits,
            "kataGoPlayedMove": playedMove ?? "",
        ]
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
        analyze: (params) => call('analyze', params)
      };
    })();
    """
}
