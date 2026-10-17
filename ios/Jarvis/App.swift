// J.A.R.V.I.S. — application iPhone
// Coquille native : affiche l'app web (mises à jour automatiques) et lui donne accès à l'iPhone
// par un pont JavaScript `window.JarvisNative` : Santé, notifications locales, dictée, retour haptique, pastille.
import UIKit
import WebKit
import HealthKit
import UserNotifications
import Speech
import AVFoundation
import WidgetKit
import AppIntents

let APP_URL = URL(string: "https://frensh-developpeur.github.io/jarvis/?app=ios")!

@main
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  var window: UIWindow?
  let web = WebController()

  func application(_ app: UIApplication, didFinishLaunchingWithOptions o: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    window = UIWindow(frame: UIScreen.main.bounds)
    window!.backgroundColor = UIColor(red: 0.008, green: 0.024, blue: 0.047, alpha: 1)
    window!.rootViewController = web
    window!.makeKeyAndVisible()
    return true
  }
  func applicationDidBecomeActive(_ app: UIApplication) { web.emit("foreground", [:]) }
  // jarvis://nutrition (widgets) : ouvre le module
  func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    if url.host == "listen" { web.deliver("listen", [:]); return true }   // réacteur (widget, Centre de contrôle, bouton Action)
    web.open("#/" + (url.host ?? "")); return true
  }

  // notification reçue app ouverte : on l'affiche quand même
  func userNotificationCenter(_ c: UNUserNotificationCenter, willPresent n: UNNotification, withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
    done([.banner, .sound, .list])
  }
  // notification touchée : ouvre le bon module
  func userNotificationCenter(_ c: UNUserNotificationCenter, didReceive r: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
    let url = r.notification.request.content.userInfo["url"] as? String ?? "#/"
    web.open(url)
    done()
  }
}

// MARK: - Vue web
class WebController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
  var webView: WKWebView!
  var ready = false
  var pendingOpen: String?
  let bridge = Bridge()

  override func loadView() {
    let cfg = WKWebViewConfiguration()
    cfg.limitsNavigationsToAppBoundDomains = true          // nécessaire au service worker (hors ligne)
    cfg.allowsInlineMediaPlayback = true
    cfg.mediaTypesRequiringUserActionForPlayback = []      // la voix de Jarvis peut parler sans toucher
    let ucc = WKUserContentController()
    ucc.add(self, name: "jarvis")
    ucc.addUserScript(WKUserScript(source: Bridge.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    cfg.userContentController = ucc
    webView = WKWebView(frame: .zero, configuration: cfg)
    webView.isOpaque = false
    webView.backgroundColor = UIColor(red: 0.008, green: 0.024, blue: 0.047, alpha: 1)
    webView.scrollView.backgroundColor = webView.backgroundColor
    webView.scrollView.contentInsetAdjustmentBehavior = .never   // comme une web app plein écran (viewport-fit=cover)
    webView.scrollView.bounces = false
    webView.allowsLinkPreview = false
    webView.allowsBackForwardNavigationGestures = false
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.customUserAgent = nil
    #if DEBUG
    if #available(iOS 16.4, *) { webView.isInspectable = true }   // inspecteur Safari depuis le Mac
    #endif
    view = webView
    bridge.web = self
    webView.load(URLRequest(url: APP_URL))
  }
  override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
  override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }

  func js(_ code: String) { DispatchQueue.main.async { self.webView.evaluateJavaScript(code, completionHandler: nil) } }
  func emit(_ event: String, _ data: Any) {
    guard ready, let d = try? JSONSerialization.data(withJSONObject: data), let s = String(data: d, encoding: .utf8) else { return }
    js("window.JarvisNative && JarvisNative._emit(\(Bridge.quote(event)), \(s))")
  }
  func open(_ url: String) { if ready { emit("open", ["url": url]) } else { pendingOpen = url } }
  var queue: [(String, [String: Any])] = []
  func deliver(_ event: String, _ data: [String: Any]) { if ready { emit(event, data) } else { queue.append((event, data)) } }

  // appels venant du JavaScript : {id, name, args}
  func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
    guard let body = m.body as? [String: Any], let name = body["name"] as? String else { return }
    let id = body["id"] as? Int ?? 0, args = body["args"] as? [String: Any] ?? [:]
    if name == "ready" {
      ready = true
      if let u = pendingOpen { pendingOpen = nil; emit("open", ["url": u]) }
      let q = queue; queue = []
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { q.forEach { self.emit($0.0, $0.1) } }
    }
    bridge.handle(name, args) { ok, value in
      let v = (try? JSONSerialization.data(withJSONObject: ["v": value ?? NSNull()])).flatMap { String(data: $0, encoding: .utf8) } ?? "{\"v\":null}"
      self.js("JarvisNative._done(\(id), \(ok), \(v).v)")
    }
  }

  // liens externes (Raccourcis, téléphone, e-mail…) : ouverts par iOS
  func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler done: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = a.request.url else { return done(.cancel) }
    if let s = url.scheme, s != "https", s != "http", s != "about", s != "blob", s != "data" {
      UIApplication.shared.open(url); return done(.cancel)
    }
    if a.targetFrame == nil, let host = url.host, !host.contains("frensh-developpeur") { UIApplication.shared.open(url); return done(.cancel) }
    done(.allow)
  }
  // page blanche après un plantage du moteur web : on recharge
  func webViewWebContentProcessDidTerminate(_ w: WKWebView) { ready = false; w.reload() }
  func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { retry(e) }
  func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { retry(e) }
  func retry(_ e: Error) {
    let html = """
    <html><head><meta name=viewport content="width=device-width,initial-scale=1"><style>body{background:#02060c;color:#3fe0ff;font:16px -apple-system;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
    button{margin-top:18px;background:none;border:1px solid #3fe0ff;color:#3fe0ff;border-radius:12px;padding:12px 22px;font-size:15px}</style></head>
    <body><div>J.A.R.V.I.S.<br><small style="color:#7aa">Connexion impossible pour le moment.</small></div><button onclick="location.href='\(APP_URL.absoluteString)'">RÉESSAYER</button></body></html>
    """
    webView.loadHTMLString(html, baseURL: URL(string: "https://frensh-developpeur.github.io/jarvis/"))
  }
}

// MARK: - Pont vers l'iPhone
class Bridge {
  weak var web: WebController?
  let health = HKHealthStore()
  let speech = SpeechEngine()

  static func quote(_ s: String) -> String {
    let d = try! JSONSerialization.data(withJSONObject: [s]); let a = String(data: d, encoding: .utf8)!
    return String(a.dropFirst().dropLast())
  }
  // injecté avant le chargement de la page
  static let script = """
  window.JarvisNative = (() => {
    let n = 0; const pend = {}, ls = {};
    const api = {
      platform: 'ios', version: '1.0',
      call(name, args) { return new Promise((res, rej) => { const id = ++n; pend[id] = {res, rej}; webkit.messageHandlers.jarvis.postMessage({id, name, args: args || {}}); }); },
      _done(id, ok, v) { const p = pend[id]; if (!p) return; delete pend[id]; ok ? p.res(v) : p.rej(new Error(v || 'Erreur')); },
      on(ev, f) { (ls[ev] = ls[ev] || []).push(f); },
      _emit(ev, d) { (ls[ev] || []).forEach(f => { try { f(d); } catch (e) {} }); },
    };
    return api;
  })();
  """

  func handle(_ name: String, _ a: [String: Any], _ done: @escaping (Bool, Any?) -> Void) {
    switch name {
    case "ready": done(true, ["version": "1.0"])
    case "haptic": haptic(a["style"] as? String ?? "light"); done(true, nil)
    case "health.authorize": healthAuthorize(done)
    case "health.read": healthRead(days: a["days"] as? Int ?? 14, done)
    case "notify.authorize": notifyAuthorize(done)
    case "notify.status": UNUserNotificationCenter.current().getNotificationSettings { s in done(true, s.authorizationStatus == .authorized ? "granted" : s.authorizationStatus == .denied ? "denied" : "default") }
    case "notify.schedule": notifySchedule(a["items"] as? [[String: Any]] ?? [], badge: a["badge"] as? Int, done)
    case "notify.clear": UNUserNotificationCenter.current().removeAllPendingNotificationRequests(); setBadge(0); done(true, nil)
    case "badge": setBadge(a["count"] as? Int ?? 0); done(true, nil)
    case "widget.update": widgetUpdate(a["data"] as? [String: Any] ?? [:]); done(true, nil)
    case "speech.start": speech.start(web: web, done)
    case "speech.stop": speech.stop(); done(true, nil)
    default: done(false, "Fonction inconnue : \(name)")
    }
  }

  // ---------- retour haptique ----------
  func haptic(_ style: String) {
    DispatchQueue.main.async {
      switch style {
      case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
      case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
      case "error": UINotificationFeedbackGenerator().notificationOccurred(.error)
      case "select": UISelectionFeedbackGenerator().selectionChanged()
      case "medium": UIImpactFeedbackGenerator(style: .medium).impactOccurred()
      case "heavy": UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
      default: UIImpactFeedbackGenerator(style: .light).impactOccurred()
      }
    }
  }

  // ---------- Santé ----------
  let sums: [(HKQuantityTypeIdentifier, String, HKUnit)] = [
    (.stepCount, "steps", .count()), (.activeEnergyBurned, "energy", .kilocalorie()), (.basalEnergyBurned, "basal", .kilocalorie()),
    (.distanceWalkingRunning, "distance", .meterUnit(with: .kilo)), (.flightsClimbed, "flights", .count()), (.appleExerciseTime, "exercise", .minute()),
  ]
  var readTypes: Set<HKObjectType> {
    var s = Set<HKObjectType>(sums.map { HKQuantityType($0.0) })
    s.insert(HKQuantityType(.restingHeartRate)); s.insert(HKQuantityType(.bodyMass)); s.insert(HKCategoryType(.sleepAnalysis))
    return s
  }
  func healthAuthorize(_ done: @escaping (Bool, Any?) -> Void) {
    guard HKHealthStore.isHealthDataAvailable() else { return done(false, "Santé indisponible sur cet appareil") }
    health.requestAuthorization(toShare: nil, read: readTypes) { ok, err in done(ok, ok ? true : (err?.localizedDescription ?? "Refusé")) }
  }
  static let dayFmt: DateFormatter = { let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"; return f }()
  func healthRead(days: Int, _ done: @escaping (Bool, Any?) -> Void) {
    guard HKHealthStore.isHealthDataAvailable() else { return done(false, "Santé indisponible") }
    let cal = Calendar.current, end = Date(), start = cal.date(byAdding: .day, value: -(days - 1), to: cal.startOfDay(for: end))!
    var out = [String: [String: Double]](), lock = NSLock()
    let put = { (day: String, key: String, v: Double) in lock.lock(); out[day, default: [:]][key] = v; lock.unlock() }
    let g = DispatchGroup()
    // cumuls par jour : pas, énergie active, métabolisme de base, distance, étages, minutes d'exercice
    for (id, key, unit) in sums {
      g.enter()
      let q = HKStatisticsCollectionQuery(quantityType: HKQuantityType(id), quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: end), options: .cumulativeSum, anchorDate: start, intervalComponents: DateComponents(day: 1))
      q.initialResultsHandler = { _, res, _ in
        res?.enumerateStatistics(from: start, to: end) { st, _ in
          if let v = st.sumQuantity()?.doubleValue(for: unit), v > 0 { put(Bridge.dayFmt.string(from: st.startDate), key, (v * 10).rounded() / 10) }
        }
        g.leave()
      }
      health.execute(q)
    }
    // fréquence cardiaque au repos : moyenne du jour
    g.enter()
    let hr = HKStatisticsCollectionQuery(quantityType: HKQuantityType(.restingHeartRate), quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: end), options: .discreteAverage, anchorDate: start, intervalComponents: DateComponents(day: 1))
    hr.initialResultsHandler = { _, res, _ in
      res?.enumerateStatistics(from: start, to: end) { st, _ in if let v = st.averageQuantity()?.doubleValue(for: HKUnit.count().unitDivided(by: .minute())) { put(Bridge.dayFmt.string(from: st.startDate), "heart", v.rounded()) } }
      g.leave()
    }
    health.execute(hr)
    // poids : dernière mesure de chaque jour
    g.enter()
    let w = HKSampleQuery(sampleType: HKQuantityType(.bodyMass), predicate: HKQuery.predicateForSamples(withStart: start, end: end), limit: HKObjectQueryNoLimit, sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]) { _, s, _ in
      for x in (s as? [HKQuantitySample]) ?? [] { put(Bridge.dayFmt.string(from: x.startDate), "weight", (x.quantity.doubleValue(for: .gramUnit(with: .kilo)) * 10).rounded() / 10) }
      g.leave()
    }
    health.execute(w)
    // sommeil : durée endormi, comptée sur le jour du réveil (depuis 18 h la veille)
    g.enter()
    let sleepStart = cal.date(byAdding: .hour, value: -6, to: start)!
    let sl = HKSampleQuery(sampleType: HKCategoryType(.sleepAnalysis), predicate: HKQuery.predicateForSamples(withStart: sleepStart, end: end), limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, s, _ in
      var perDay = [String: Double]()
      let asleep: Set<Int> = [HKCategoryValueSleepAnalysis.asleepCore.rawValue, HKCategoryValueSleepAnalysis.asleepDeep.rawValue, HKCategoryValueSleepAnalysis.asleepREM.rawValue, HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue]
      // plusieurs sources (montre + téléphone) : on garde la source qui compte le plus de sommeil chaque nuit
      var bySource = [String: [String: Double]]()
      for x in (s as? [HKCategorySample]) ?? [] where asleep.contains(x.value) {
        let day = Bridge.dayFmt.string(from: cal.date(byAdding: .hour, value: 6, to: x.endDate)!)
        bySource[x.sourceRevision.source.bundleIdentifier, default: [:]][day, default: 0] += x.endDate.timeIntervalSince(x.startDate) / 3600
      }
      for (_, days) in bySource { for (d, h) in days { perDay[d] = max(perDay[d] ?? 0, h) } }
      for (d, h) in perDay where h > 0.5 { put(d, "sleep", (h * 10).rounded() / 10) }
      g.leave()
    }
    health.execute(sl)
    g.notify(queue: .main) { done(true, ["days": out]) }
  }

  // ---------- notifications locales ----------
  func notifyAuthorize(_ done: @escaping (Bool, Any?) -> Void) {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { ok, err in done(true, ok ? "granted" : "denied") }
  }
  // remplace toutes les notifications prévues par la liste reçue (iOS en garde 64 au maximum)
  func notifySchedule(_ items: [[String: Any]], badge: Int?, _ done: @escaping (Bool, Any?) -> Void) {
    let c = UNUserNotificationCenter.current()
    c.removeAllPendingNotificationRequests()
    let now = Date().timeIntervalSince1970 * 1000
    let list = items.compactMap { i -> (Double, [String: Any])? in guard let at = i["at"] as? Double, at > now + 5000 else { return nil }; return (at, i) }.sorted { $0.0 < $1.0 }.prefix(60)
    for (at, i) in list {
      let content = UNMutableNotificationContent()
      content.title = i["title"] as? String ?? "J.A.R.V.I.S."
      content.body = i["body"] as? String ?? ""
      content.sound = .default
      content.userInfo = ["url": i["url"] as? String ?? "#/"]
      if let t = i["thread"] as? String { content.threadIdentifier = t }
      let date = Date(timeIntervalSince1970: at / 1000)
      let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
      c.add(UNNotificationRequest(identifier: i["nid"] as? String ?? UUID().uuidString, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)))
    }
    if let b = badge { setBadge(b) }
    done(true, list.count)
  }
  func setBadge(_ n: Int) { UNUserNotificationCenter.current().setBadgeCount(max(0, n)) }

  // ---------- widgets : l'app dépose les chiffres du moment, les widgets les relisent ----------
  var lastWidget: Data?
  func widgetUpdate(_ d: [String: Any]) {
    var w = d; w["updatedAt"] = Date().timeIntervalSince1970 * 1000
    guard let json = try? JSONSerialization.data(withJSONObject: w), let decoded = try? JSONDecoder().decode(WidgetData.self, from: json),
          let data = try? JSONEncoder().encode(decoded) else { return }
    var cmp = decoded; cmp.updatedAt = 0
    let sig = try? JSONEncoder().encode(cmp)
    UserDefaults(suiteName: APP_GROUP)?.set(data, forKey: "widget")
    if sig != lastWidget { lastWidget = sig; WidgetCenter.shared.reloadAllTimelines() }   // ne redessine que si un chiffre change
  }
}

// MARK: - Siri et Raccourcis
// « Dis Siri, demande à Jarvis » → Siri demande quoi, l'app s'ouvre et Jarvis répond à voix haute
func deliverToWeb(_ event: String, _ data: [String: Any] = [:]) {
  DispatchQueue.main.async { (UIApplication.shared.delegate as? AppDelegate)?.web.deliver(event, data) }
}
struct AskJarvisIntent: AppIntent {
  static var title: LocalizedStringResource = "Demander à Jarvis"
  static var description = IntentDescription("Envoie une demande à Jarvis : une dépense, un repas, une tâche, une question.")
  static var openAppWhenRun = true
  @Parameter(title: "Demande", requestValueDialog: "Que dois-je faire ?") var text: String
  @MainActor func perform() async throws -> some IntentResult { deliverToWeb("ask", ["text": text]); return .result() }
}
struct BriefingIntent: AppIntent {
  static var title: LocalizedStringResource = "Briefing de Jarvis"
  static var description = IntentDescription("Jarvis vous fait le point de la journée.")
  static var openAppWhenRun = true
  @MainActor func perform() async throws -> some IntentResult { deliverToWeb("briefing"); return .result() }
}
struct ListenIntent: AppIntent {
  static var title: LocalizedStringResource = "Parler à Jarvis"
  static var description = IntentDescription("Ouvre Jarvis en écoute.")
  static var openAppWhenRun = true
  @MainActor func perform() async throws -> some IntentResult { deliverToWeb("listen"); return .result() }
}
struct JarvisShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(intent: AskJarvisIntent(), phrases: ["Demande à \(.applicationName)", "Dis à \(.applicationName)", "\(.applicationName) note"], shortTitle: "Demander", systemImageName: "bubble.left.and.bubble.right")
    AppShortcut(intent: BriefingIntent(), phrases: ["Briefing \(.applicationName)", "Mon briefing \(.applicationName)", "\(.applicationName) quoi de neuf"], shortTitle: "Briefing", systemImageName: "sun.max")
    AppShortcut(intent: ListenIntent(), phrases: ["Parle à \(.applicationName)", "Écoute \(.applicationName)"], shortTitle: "Parler", systemImageName: "waveform")
  }
}

// MARK: - Dictée (reconnaissance vocale de l'iPhone, en français)
class SpeechEngine {
  let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "fr-FR"))
  let engine = AVAudioEngine()
  var request: SFSpeechAudioBufferRecognitionRequest?
  var task: SFSpeechRecognitionTask?
  weak var web: WebController?
  var stopTimer: Timer?

  func start(web: WebController?, _ done: @escaping (Bool, Any?) -> Void) {
    self.web = web
    SFSpeechRecognizer.requestAuthorization { st in
      guard st == .authorized else { return done(false, "not-allowed") }
      AVAudioApplication.requestRecordPermission { ok in
        guard ok else { return done(false, "not-allowed") }
        DispatchQueue.main.async { do { try self.begin(); done(true, nil) } catch { done(false, error.localizedDescription) } }
      }
    }
  }
  private func begin() throws {
    stop()
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker])
    try session.setActive(true, options: .notifyOthersOnDeactivation)
    let req = SFSpeechAudioBufferRecognitionRequest(); req.shouldReportPartialResults = true
    if recognizer?.supportsOnDeviceRecognition == true { req.requiresOnDeviceRecognition = false }
    request = req
    let input = engine.inputNode, fmt = input.outputFormat(forBus: 0)
    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: 1024, format: fmt) { buf, _ in req.append(buf) }
    engine.prepare(); try engine.start()
    task = recognizer?.recognitionTask(with: req) { [weak self] res, err in
      guard let self = self else { return }
      if let r = res {
        self.web?.emit("speech", ["text": r.bestTranscription.formattedString, "final": r.isFinal])
        // silence de 1,6 s après la dernière parole : on s'arrête, comme la dictée native
        DispatchQueue.main.async { self.stopTimer?.invalidate(); self.stopTimer = Timer.scheduledTimer(withTimeInterval: 1.6, repeats: false) { _ in self.finish() } }
        if r.isFinal { self.finish() }
      }
      if err != nil { self.finish() }
    }
  }
  func finish() {
    guard task != nil || engine.isRunning else { return }
    stop()
    web?.emit("speech", ["end": true])
  }
  func stop() {
    stopTimer?.invalidate(); stopTimer = nil
    if engine.isRunning { engine.stop(); engine.inputNode.removeTap(onBus: 0) }
    request?.endAudio(); task?.cancel(); task = nil; request = nil
    try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
  }
}
