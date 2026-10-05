import Foundation
import WebKit
import UIKit
import CoreML
import MachO

final class KataGoBridge: NSObject, WKScriptMessageHandler {
    static let shared = KataGoBridge()

    // MARK: The bot check at cold start

    /// The device plays the on-device bots (`capabilities().localBots`) when
    /// the probe's search runs at this many network evaluations a second or
    /// more. PROVISIONAL: set between the two cases on record (an M-series
    /// iPad at roughly 80 a second, an older iPad at about a minute a move);
    /// to be set from real devices.
    static let localBotsMinEvalsPerSecond = 10.0
    /// The probe's method. A stored reading is trusted only under the same
    /// version: 1 timed one 16-visit search; 2 takes the median of up to
    /// three after an untimed warm-up search.
    static let probeVersion = 2
    /// The probe: searches of this many visits on an empty 9x9 board (the
    /// size of the bots' own searches)...
    static let probeVisits = 16
    /// ...an untimed warm-up search first (the first search after the start
    /// pays one-time costs), stopped here at the latest...
    static let probeWarmUpMaxSeconds = 1.0
    /// ...then up to this many timed searches; the reading is their median,
    /// so one search slowed by other work at cold start does not set it...
    static let probeTimedSearches = 3
    /// ...inside this many seconds in all, so a slow device is sorted in
    /// seconds rather than a minute (a search is cut at what is left).
    static let probeMaxSeconds = 4.0
    /// UserDefaults keys; each value carries the app version it was measured
    /// under and is measured again when the version changes.
    private static let probeDefaultsKey = "GoForKids.engineProbe"
    private static let humanPackageDefaultsKey = "GoForKids.humanPackageCheck"

    private weak var webView: WKWebView?
    /// Every engine command runs here, one at a time, behind the engine's start.
    private let workQueue = DispatchQueue(label: "com.goforkids.katago.bridge")
    /// Commands that never touch the engine (ping, log, shareSGF) answer here,
    /// so they do not wait behind the engine's start.
    private let miscQueue = DispatchQueue(label: "com.goforkids.katago.bridge.misc")
    private var enginePumpStarted = false
    /// Monotonic counter so [perf] log lines can be cross-referenced with JS
    /// and grepped per-call. Reset on engine restart (not on new game).
    private var analyzeCallCount = 0

    // Engine state. Set on workQueue at start; the stop reason also comes
    // from the engine thread, hence the lock.
    private var engineUp = false
    private var humanModelLoaded = false
    private var evalsPerSecond = 0.0
    private let stopLock = NSLock()
    private var engineGeneration = 0
    private var stopReason: String? = nil

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
        // The first job on the engine queue: every engine command the page
        // sends waits behind it.
        workQueue.async { [weak self] in
            guard let self else { return }
            self.bootEngine()
            self.resolveProbe()
        }
    }

    /// Start the engine with the human SL net when it is in the bundle; if
    /// it does not come up with it, start it without and remember that the
    /// human net is absent. Either way the standard bots are as before: no
    /// search evaluates the human net unless humanSLProfile is set, and only
    /// humanPolicy sets it (and unsets it before it returns).
    private func bootEngine() {
        if KataGoHelper.humanModelInBundle() {
            // The pre-check and the engine's load run inside the crash-loop
            // guard's window: if the app dies there, a later launch starts
            // without the human net (HumanLoadGuard).
            let loadGuard = HumanLoadGuard(url: HumanLoadGuard.defaultURL(), version: Self.appVersion())
            if !loadGuard.shouldTryHumanNet() {
                print("[Bridge] A launch stopped while loading the human SL net; starting the engine without it")
            } else {
                loadGuard.willLoad()
                if humanPackageCompiles(), let models = launchEngine(withHumanModel: true) {
                    loadGuard.didFinishLoad()
                    engineUp = true
                    humanModelLoaded = Self.modelsIncludeHumanNet(models)
                    print("[Bridge] Engine up, human SL net loaded: \(humanModelLoaded)")
                    return
                }
                loadGuard.didFinishLoad()
                print("[Bridge] Engine did not come up with the human SL net; starting it without")
                KataGoHelper.discardPendingInput()
            }
        } else {
            print("[Bridge] Human SL net not in the bundle; starting the engine without it")
        }
        humanModelLoaded = false
        engineUp = launchEngine(withHumanModel: false) != nil
        print("[Bridge] Engine up (no human SL net): \(engineUp)")
    }

    /// Start the GTP thread and wait for the engine's first reply, which it
    /// gives only once its nets are loaded. Returns the reply to
    /// kata-get-models, or nil when the engine stopped instead.
    private func launchEngine(withHumanModel human: Bool) -> String? {
        stopLock.lock()
        engineGeneration += 1
        let generation = engineGeneration
        stopReason = nil
        stopLock.unlock()
        print("[Bridge] Spawning KataGo GTP thread (human SL net: \(human))")
        Thread { [weak self] in
            let reason = KataGoHelper.runGtp(withHumanModel: human)
            print("[Bridge] KataGo engine stopped: \(reason)")
            guard let self else { return }
            self.stopLock.lock()
            if self.engineGeneration == generation { self.stopReason = reason }
            self.stopLock.unlock()
        }.start()
        let reply = gtp("kata-get-models")
        return reply.hasPrefix("=") ? reply : nil
    }

    /// kata-get-models answers a JSON list; the human SL net is the entry
    /// that uses a humanSLProfile.
    static func modelsIncludeHumanNet(_ reply: String) -> Bool {
        let json = reply.drop(while: { $0 == "=" || $0 == " " })
        guard let data = json.data(using: .utf8),
              let models = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return false
        }
        return models.contains { ($0["usesHumanSLProfile"] as? Bool) == true }
    }

    /// The engine loads a CoreML package that fails to compile without an
    /// error, and fails only when that net is first evaluated, which would
    /// take the app down. So the human package is compiled and loaded once
    /// per app version before the engine is given it (here, with CoreML
    /// directly: the fork's KataGoSwift module targets iOS 17 and this app
    /// 16.4). The engine compiles it again into its own cache, so the first
    /// launch of a version pays the compile twice.
    private func humanPackageCompiles() -> Bool {
        let version = Self.appVersion()
        if let stored = UserDefaults.standard.dictionary(forKey: Self.humanPackageDefaultsKey),
           stored["appVersion"] as? String == version,
           let ok = stored["ok"] as? Bool {
            return ok
        }
        var ok = false
        if let url = Bundle.main.url(forResource: "KataGoModel19x19fp16m1", withExtension: "mlpackage") {
            do {
                let tStart = Date()
                let compiled = try MLModel.compileModel(at: url)
                defer { try? FileManager.default.removeItem(at: compiled) }
                let config = MLModelConfiguration()
                config.computeUnits = .cpuAndNeuralEngine  // coremlDeviceToUse = 100
                _ = try MLModel(contentsOf: compiled, configuration: config)
                ok = true
                print("[Bridge] Human SL package compiled and loaded in \(Int(Date().timeIntervalSince(tStart) * 1000))ms")
            } catch {
                print("[Bridge] Human SL package failed to compile or load: \(error)")
            }
        }
        UserDefaults.standard.set(["appVersion": version, "ok": ok], forKey: Self.humanPackageDefaultsKey)
        return ok
    }

    /// Read the probe for this app version from UserDefaults, or run it once
    /// and keep it. A failed probe is not kept, so the next launch tries again.
    private func resolveProbe() {
        guard engineUp else { evalsPerSecond = 0; return }
        let version = Self.appVersion()
        // A reading stored by another app version or another probe method
        // (version 1's records have no probeVersion) is measured again.
        if let stored = UserDefaults.standard.dictionary(forKey: Self.probeDefaultsKey),
           stored["appVersion"] as? String == version,
           stored["probeVersion"] as? Int == Self.probeVersion,
           let eps = stored["evalsPerSecond"] as? Double {
            evalsPerSecond = eps
            print("[Bridge] Probe v\(Self.probeVersion) (stored for \(version)): \(eps) evals/s")
            return
        }
        do {
            let reads = try runProbe()
            let eps = Self.median(reads)
            evalsPerSecond = eps
            UserDefaults.standard.set([
                "appVersion": version,
                "probeVersion": Self.probeVersion,
                "probeVisits": Self.probeVisits,
                "reads": reads,
                "evalsPerSecond": eps,
                "measuredAt": ISO8601DateFormatter().string(from: Date()),
            ], forKey: Self.probeDefaultsKey)
            print("[Bridge] Probe v\(Self.probeVersion) (measured for \(version)): \(eps) evals/s, reads \(reads.map { ($0 * 10).rounded() / 10 })")
        } catch {
            evalsPerSecond = 0
            print("[Bridge] Probe failed: \(error)")
        }
    }

    /// One untimed evaluation and one untimed warm-up search first (each
    /// pays one-time costs), then up to `probeTimedSearches` timed searches,
    /// each from an empty cache, until `probeMaxSeconds` of timed search is
    /// spent. Returns each search's visits a second; at least one.
    private func runProbe() throws -> [Double] {
        try setUpPosition(Position(boardSize: 9, komi: 7, rules: "tromp-taylor", moves: [], color: "B"))
        try gtpOK("kata-raw-nn 0")
        try gtpOK("clear_cache")
        try setSearchParams(visits: Self.probeVisits, maxTime: Self.probeWarmUpMaxSeconds)
        try gtpOK("kata-search_analyze B rootInfo true")
        var reads: [Double] = []
        var spent = 0.0
        while reads.count < Self.probeTimedSearches && spent < Self.probeMaxSeconds {
            try gtpOK("clear_cache")
            try setSearchParams(visits: Self.probeVisits, maxTime: Self.probeMaxSeconds - spent)
            let t0 = Date()
            let reply = try gtpOK("kata-search_analyze B rootInfo true")
            let seconds = max(Date().timeIntervalSince(t0), 0.001)
            spent += seconds
            let visits = Self.parseRootInfo(reply)?["visits"] ?? 1
            reads.append(visits / seconds)
        }
        return reads
    }

    /// The middle value; the mean of the middle two for an even count.
    static func median(_ values: [Double]) -> Double {
        let s = values.sorted()
        guard !s.isEmpty else { return 0 }
        let mid = s.count / 2
        return s.count % 2 == 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
    }

    private static func appVersion() -> String {
        let info = Bundle.main.infoDictionary ?? [:]
        let short = (info["CFBundleShortVersionString"] as? String) ?? "?"
        let build = (info["CFBundleVersion"] as? String) ?? "?"
        return "\(short) (\(build))"
    }

    private func requireEngine() throws {
        stopLock.lock()
        let reason = stopReason
        stopLock.unlock()
        if let reason { throw BridgeError.engineUnavailable(reason) }
        if !engineUp { throw BridgeError.engineUnavailable("the engine did not start") }
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
        let usesEngine = ["analyze", "humanPolicy", "scoreAfter", "capabilities"].contains(cmd)
        (usesEngine ? workQueue : miscQueue).async { [weak self] in
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
        case "humanPolicy":
            return try humanPolicy(params: params)
        case "scoreAfter":
            return try scoreAfter(params: params)
        case "capabilities":
            // Resolved once at cold start (bootEngine, resolveProbe), which
            // this queue runs before any command from the page.
            return [
                "localBots": engineUp && evalsPerSecond >= Self.localBotsMinEvalsPerSecond,
                "evalsPerSecond": (evalsPerSecond * 10).rounded() / 10,
                "probeVersion": Self.probeVersion,
                "humanModel": engineUp && humanModelLoaded,
            ]
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
        try requireEngine()
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
            } else if line.hasPrefix("?") {
                // An error reply (or the engine stopped): without this the
                // loop would wait forever for a `play` line.
                throw BridgeError.engine("\(analyzeCmd): \(line)")
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

    // MARK: The human SL path (frontend/src/ai/humanNetSelector.ts)

    /// The position every engine command starts from: the keys `analyze`
    /// takes.
    struct Position {
        let boardSize: Int
        let komi: Double
        let rules: String
        let moves: [(color: String, point: String)]
        /// The side to move: "B" or "W".
        let color: String

        init(boardSize: Int, komi: Double, rules: String, moves: [(color: String, point: String)], color: String) {
            self.boardSize = boardSize
            self.komi = komi
            self.rules = rules
            self.moves = moves
            self.color = color
        }

        init(params: [String: Any]) throws {
            guard let boardSize = KataGoBridge.intParam(params["boardSize"]),
                  (2...19).contains(boardSize),  // COMPILE_MAX_BOARD_LEN
                  let komi = (params["komi"] as? NSNumber)?.doubleValue,
                  let rawMoves = params["moves"] as? [[String: Any]],
                  let color = (params["color"] as? String)?.uppercased(),
                  color == "B" || color == "W" else {
                throw BridgeError.invalidParams
            }
            var moves: [(color: String, point: String)] = []
            for move in rawMoves {
                guard let mc = (move["color"] as? String)?.uppercased(), mc == "B" || mc == "W",
                      let mp = move["point"] as? String, !mp.contains(" ") else {
                    throw BridgeError.invalidParams
                }
                moves.append((mc, mp))
            }
            let rules = (params["rules"] as? String) ?? "tromp-taylor"
            guard !rules.isEmpty, !rules.contains(" ") else { throw BridgeError.invalidParams }
            self.init(boardSize: boardSize, komi: komi, rules: rules, moves: moves, color: color)
        }
    }

    /// `humanPolicy(params)` → HumanPolicyAnswer: the human net's policy under
    /// the profile and the main net's raw policy, each size² + 1 values
    /// row-major from the top-left, pass last, illegal points negative; and
    /// the root lead from Black's side. `humanPolicy` is null when the engine
    /// runs without the human net.
    ///
    /// Params: the position (as `analyze`), the profile (`profile` or
    /// `profileName`, e.g. "rank_20k") and the visits (`visits` or `maxVisits`)
    /// of the search that reads the root lead.
    private func humanPolicy(params: [String: Any]) throws -> [String: Any] {
        let pos = try Position(params: params)
        guard let profile = (params["profile"] as? String) ?? (params["profileName"] as? String),
              !profile.isEmpty, !profile.contains(" "),
              let visits = Self.intParam(params["visits"] ?? params["maxVisits"]), visits >= 1 else {
            throw BridgeError.invalidParams
        }
        try requireEngine()
        let tStart = Date()
        try setUpPosition(pos)
        // The search comes first: like analyze's genmove it makes `color` the
        // side to move (KataGo clears the history if that differs from the
        // move list), so the raw evaluations below see the same root. It runs
        // with no human profile set, and reads the root lead.
        try setSearchParams(visits: visits, maxTime: 60)
        let search = try gtpOK("kata-search_analyze \(pos.color) rootInfo true")
        var human: Any = NSNull()
        if humanModelLoaded {
            try gtpOK("kata-set-param humanSLProfile \(profile)")
            let humanReply = Result { try gtpOK("kata-raw-human-nn 0") }
            // Unset at once: with a profile set, every search would also
            // evaluate the human net at its root.
            try gtpOK("kata-set-param humanSLProfile")
            human = try Self.parseRawPolicy(humanReply.get(), boardSize: pos.boardSize)
        }
        let mainReply = try gtpOK("kata-raw-nn 0")
        let policy = try Self.parseRawPolicy(mainReply, boardSize: pos.boardSize)
        let lead: Double
        if let root = Self.parseRootInfo(search), let sideLead = root["scoreLead"] {
            lead = pos.color == "B" ? sideLead : -sideLead
        } else if let whiteLead = Self.parseRawValues(mainReply)["whiteLead"] {
            // A one-visit search prints no analysis line; its root is the
            // raw net's evaluation.
            lead = -whiteLead
        } else {
            throw BridgeError.engine("humanPolicy: no root lead in the engine's replies")
        }
        print("[Bridge] humanPolicy \(profile) board=\(pos.boardSize) moves=\(pos.moves.count) visits=\(visits) lead=\(String(format: "%.2f", lead)) human=\(humanModelLoaded) in \(Int(Date().timeIntervalSince(tStart) * 1000))ms")
        return ["humanPolicy": human, "policy": policy, "scoreLead": lead]
    }

    /// `scoreAfter(params)` → ScoreAfterAnswer `{ scoreLead, winrate }`: the
    /// main net's read, at the given visits, of the position after the side
    /// to move plays the candidate, with no human profile and no root noise
    /// shaping the search. Both from Black's side.
    ///
    /// Params: the position (as `analyze`), the candidate `move` (a GTP
    /// coordinate such as "E5" or "pass", or `{row, col}` with row 0 at the
    /// top) and the visits (`visits` or `maxVisits`).
    private func scoreAfter(params: [String: Any]) throws -> [String: Any] {
        let pos = try Position(params: params)
        guard let move = Self.moveParam(params["move"], boardSize: pos.boardSize),
              let visits = Self.intParam(params["visits"] ?? params["maxVisits"]), visits >= 1 else {
            throw BridgeError.invalidParams
        }
        try requireEngine()
        let tStart = Date()
        try setUpPosition(pos)
        try gtpOK("play \(pos.color) \(move)")
        let next = pos.color == "B" ? "W" : "B"
        try setSearchParams(visits: visits, maxTime: 60)
        let search = try gtpOK("kata-search_analyze \(next) rootInfo true")
        let lead: Double
        let winrate: Double
        if let root = Self.parseRootInfo(search), let sideLead = root["scoreLead"], let sideWinrate = root["winrate"] {
            // rootInfo is from the side to move (reportAnalysisWinratesAs is
            // left at SIDETOMOVE in default_gtp.cfg).
            lead = next == "B" ? sideLead : -sideLead
            winrate = next == "B" ? sideWinrate : 1 - sideWinrate
        } else {
            // A one-visit search prints no analysis line; read the root from
            // the raw net (White's side).
            let raw = Self.parseRawValues(try gtpOK("kata-raw-nn 0"))
            guard let whiteLead = raw["whiteLead"], let whiteWin = raw["whiteWin"], let whiteLoss = raw["whiteLoss"] else {
                throw BridgeError.engine("scoreAfter: no root values in the engine's replies")
            }
            lead = -whiteLead
            winrate = 1 - 0.5 * (1 + whiteWin - whiteLoss)
        }
        print("[Bridge] scoreAfter \(pos.color) \(move) board=\(pos.boardSize) moves=\(pos.moves.count) visits=\(visits) lead=\(String(format: "%.2f", lead)) in \(Int(Date().timeIntervalSince(tStart) * 1000))ms")
        return ["scoreLead": lead, "winrate": winrate]
    }

    private func setUpPosition(_ pos: Position) throws {
        try gtpOK("clear_board")
        try gtpOK("boardsize \(pos.boardSize)")
        try gtpOK("komi \(pos.komi)")
        try gtpOK("kata-set-rules \(pos.rules)")
        for move in pos.moves {
            try gtpOK("play \(move.color) \(move.point)")
        }
    }

    /// Set on every search: the engine is long-lived and keeps what the last
    /// command set (analyze sets a profile's wideRootNoise).
    private func setSearchParams(visits: Int, maxTime: Double) throws {
        try gtpOK("kata-set-param maxVisits \(visits)")
        try gtpOK("kata-set-param maxTime \(maxTime)")
        try gtpOK("kata-set-param wideRootNoise 0.0")
    }

    /// A whole number from JS (which sends every number as a double).
    static func intParam(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber else { return nil }
        let d = number.doubleValue
        guard d.isFinite, d == d.rounded(), abs(d) < 1e9 else { return nil }
        return Int(d)
    }

    /// The candidate as a GTP coordinate: "E5" / "pass" as given, or
    /// `{row, col}` with row 0 at the top (frontend toGtp's convention).
    static func moveParam(_ value: Any?, boardSize: Int) -> String? {
        let letters = Array("ABCDEFGHJKLMNOPQRST")  // GTP skips I
        if let text = value as? String {
            let t = text.trimmingCharacters(in: .whitespaces).uppercased()
            if t == "PASS" { return "pass" }
            guard let letter = t.first, let col = letters.firstIndex(of: letter), col < boardSize,
                  let number = Int(t.dropFirst()), (1...boardSize).contains(number) else {
                return nil
            }
            return t
        }
        if let point = value as? [String: Any],
           let row = intParam(point["row"]), let col = intParam(point["col"]),
           (0..<boardSize).contains(row), (0..<boardSize).contains(col) {
            return "\(letters[col])\(boardSize - row)"
        }
        return nil
    }

    /// The `policy` grid and `policyPass` of a kata-raw-nn / kata-raw-human-nn
    /// reply: rows from the top, pass last; NAN (illegal) becomes -1.
    static func parseRawPolicy(_ reply: String, boardSize: Int) throws -> [Double] {
        var values: [Double] = []
        var inGrid = false
        for rawLine in reply.split(separator: "\n", omittingEmptySubsequences: false) {
            var line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("=") { line = String(line.dropFirst()).trimmingCharacters(in: .whitespaces) }
            if line == "policy" { inGrid = true; continue }
            if line.hasPrefix("policyPass") {
                let tokens = line.split(separator: " ")
                guard tokens.count >= 2 else { break }
                values.append(Self.policyValue(tokens[1]))
                inGrid = false
                break
            }
            if inGrid {
                for token in line.split(separator: " ") { values.append(Self.policyValue(token)) }
            }
        }
        guard values.count == boardSize * boardSize + 1, !values.contains(where: { $0.isNaN }) else {
            throw BridgeError.engine("policy has \(values.count) values, expected \(boardSize * boardSize + 1)")
        }
        return values
    }

    private static func policyValue(_ token: Substring) -> Double {
        if token.uppercased().hasPrefix("NAN") { return -1 }
        return Double(token) ?? .nan
    }

    /// The scalar lines of a kata-raw-nn reply (whiteWin, whiteLoss,
    /// whiteLead, ...): White's side.
    static func parseRawValues(_ reply: String) -> [String: Double] {
        var out: [String: Double] = [:]
        for rawLine in reply.split(separator: "\n") {
            var line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("=") { line = String(line.dropFirst()).trimmingCharacters(in: .whitespaces) }
            let tokens = line.split(separator: " ")
            if tokens.count == 2, let v = Double(tokens[1]) { out[String(tokens[0])] = v }
        }
        return out
    }

    /// The key/value pairs after ` rootInfo ` on a kata-search_analyze info
    /// line (visits, winrate, scoreLead, ...: the side to move's view). Nil
    /// when the reply has no analysis line (a one-visit search).
    static func parseRootInfo(_ reply: String) -> [String: Double]? {
        guard let range = reply.range(of: " rootInfo ") else { return nil }
        let tokens = reply[range.upperBound...].split(whereSeparator: { $0 == " " || $0 == "\n" })
        var out: [String: Double] = [:]
        var i = 0
        while i + 1 < tokens.count, let v = Double(tokens[i + 1]) {
            out[String(tokens[i])] = v
            i += 2
        }
        return out.isEmpty ? nil : out
    }

    // MARK: GTP

    /// Send one command and return its whole reply (every line of it).
    @discardableResult
    private func gtp(_ command: String) -> String {
        KataGoHelper.sendCommand(command)
        let response = readResponse()
        // Log the first line only, truncated, so the log isn't a wall of text
        let first = response.split(separator: "\n", maxSplits: 1).first.map(String.init) ?? ""
        let lines = response.split(separator: "\n", omittingEmptySubsequences: false).count
        let preview = (first.count > 80 ? String(first.prefix(80)) + "…" : first) + (lines > 1 ? " (+\(lines - 1) lines)" : "")
        print("[Bridge] GTP > \(command)  <  \(preview)")
        return response
    }

    /// `gtp`, throwing on an error reply (`? ...`).
    @discardableResult
    private func gtpOK(_ command: String) throws -> String {
        let response = gtp(command)
        if response.hasPrefix("?") { throw BridgeError.engine("\(command): \(response)") }
        return response
    }

    /// A GTP reply runs from its first non-empty line to the next empty one.
    private func readResponse() -> String {
        var lines: [String] = []
        while true {
            let line = KataGoHelper.getMessageLine()
            if lines.isEmpty {
                if line.isEmpty { continue }
                lines.append(line)
            } else if line.isEmpty {
                break
            } else {
                lines.append(line)
            }
        }
        return lines.joined(separator: "\n")
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
        case engine(String)
        case engineUnavailable(String)
        var description: String {
            switch self {
            case .unknownCommand(let c): return "Unknown bridge command: \(c)"
            case .invalidParams: return "Invalid bridge params"
            case .engine(let m): return "Engine error: \(m)"
            case .engineUnavailable(let m): return "Engine unavailable: \(m)"
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

// MARK: HumanLoadGuard (Foundation and MachO only; the macOS test harness compiles this block as it stands)

/// The crash-loop guard for the human SL net. The pre-check compiles the
/// package with CoreML, but the engine's own load can still take the app
/// down (a crash, or the system ending an app that needs too much memory),
/// and every later launch would try again. So a record is written before
/// the load and closed after it: a launch that finds it still open knows
/// the last one died loading, starts without the human net (the bridge then
/// answers `humanModel: false`) and counts it. The launch after that tries
/// again: a second load in a row that never finished leaves the human net
/// off for this build. A load that finishes, with the net or without it,
/// clears the count.
///
/// The record belongs to one build, not one version: the app's version
/// string stays the same from one Xcode build to the next, and a kill while
/// loading (Xcode's stop, a force-quit, the system ending the app) looks the
/// same as a crash. Every new build starts with a clean count; two such
/// kills in a row on one unchanged build do leave the net off until a new
/// build is installed (any code or frontend change), the app is deleted, or
/// the version changes. A file, written whole, so the record is on disk
/// before the load starts.
struct HumanLoadGuard {
    static let maxCrashes = 2

    struct Record: Codable, Equatable {
        var appVersion: String
        var build: String
        var loading: Bool
        var crashes: Int
    }

    let url: URL
    let version: String
    let build: String

    init(url: URL, version: String, build: String = HumanLoadGuard.currentBuild()) {
        self.url = url
        self.version = version
        self.build = build
    }

    static func defaultURL() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("GoForKids", isDirectory: true)
            .appendingPathComponent("human-net-load.json")
    }

    /// What tells one build installed from the next: the UUID the linker
    /// gave the binary this code is in (under Xcode's debug dylib, that
    /// dylib), which changes when the code changes, and the modification
    /// date of the bundled web app's index.html, which the frontend phase
    /// rewrites on every build (a frontend-only build does not relink).
    /// Both are fixed for the life of one install.
    static func currentBuild() -> String {
        let uuid = imageUUID(#dsohandle) ?? "?"
        var web = "-"
        if let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web"),
           let date = (try? FileManager.default.attributesOfItem(atPath: index.path))?[.modificationDate] as? Date {
            web = String(date.timeIntervalSince1970)
        }
        return "\(uuid) \(web)"
    }

    /// The LC_UUID of the Mach-O image whose header is at `header`.
    static func imageUUID(_ header: UnsafeRawPointer) -> String? {
        let mh = header.load(as: mach_header_64.self)
        guard mh.magic == MH_MAGIC_64 else { return nil }
        var command = header + MemoryLayout<mach_header_64>.size
        for _ in 0..<mh.ncmds {
            let lc = command.load(as: load_command.self)
            if lc.cmd == UInt32(LC_UUID) {
                return UUID(uuid: command.load(as: uuid_command.self).uuid).uuidString
            }
            command += Int(lc.cmdsize)
        }
        return nil
    }

    /// This build's record; one from another build or version counts as none.
    func read() -> Record? {
        guard let data = try? Data(contentsOf: url),
              let record = try? JSONDecoder().decode(Record.self, from: data),
              record.appVersion == version, record.build == build else { return nil }
        return record
    }

    private func write(_ record: Record) {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(),
                                                 withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(record) {
            try? data.write(to: url, options: .atomic)
        }
    }

    private func fresh() -> Record {
        Record(appVersion: version, build: build, loading: false, crashes: 0)
    }

    /// At launch, before any load: whether to give the engine the human net.
    func shouldTryHumanNet() -> Bool {
        guard var record = read() else { return true }
        if record.loading {
            // The last launch died between willLoad and didFinishLoad.
            record.loading = false
            record.crashes += 1
            write(record)
            return false
        }
        return record.crashes < Self.maxCrashes
    }

    /// Just before the pre-check and the engine's load.
    func willLoad() {
        var record = read() ?? fresh()
        record.loading = true
        write(record)
    }

    /// After the load returned, with the net or without it (the pre-check
    /// said no, or the engine stopped): not a crash, so the count clears.
    func didFinishLoad() {
        write(fresh())
    }
}

// MARK: HumanLoadGuard end

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
        humanPolicy: (params) => call('humanPolicy', params),
        scoreAfter: (params) => call('scoreAfter', params),
        capabilities: () => call('capabilities', {}),
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
