// Jarvis sans ouvrir l'app : Siri, Centre de contrôle, bouton Action.
// L'intention appelle directement l'API de Jarvis avec la session et le résumé des données que l'app dépose
// dans le groupe d'apps ; les actions (dépense, repas, tâche…) sont mises en attente et appliquées par l'app.
import AppIntents
import Foundation

enum JarvisError: Error, CustomLocalizedStringResourceConvertible {
  case notLogged, network(String)
  var localizedStringResource: LocalizedStringResource {
    switch self {
    case .notLogged: return "Ouvrez Jarvis une fois pour vous connecter."
    case .network(let m): return "Jarvis est injoignable pour le moment (\(m))."
    }
  }
}

enum JarvisRemote {
  static var defaults: UserDefaults? { UserDefaults(suiteName: APP_GROUP) }

  static func ask(_ text: String) async throws -> String {
    guard let d = defaults, let token = d.string(forKey: "token"), let api = d.string(forKey: "api"), let url = URL(string: api + "/api/chat") else { throw JarvisError.notLogged }
    var req = URLRequest(url: url); req.httpMethod = "POST"; req.timeoutInterval = 25
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
    let history = Array(((d.array(forKey: "siriLog") as? [[String: String]]) ?? []).suffix(6))   // la conversation continue d'un appel à l'autre
    let f = DateFormatter(); f.locale = Locale(identifier: "fr_FR"); f.dateFormat = "EEEE d MMMM yyyy, HH:mm"
    let body: [String: Any] = ["messages": history + [["role": "user", "content": text]], "context": d.string(forKey: "context") ?? "",
                               "name": d.string(forKey: "name") ?? "Monsieur", "now": f.string(from: Date()), "calendar": d.string(forKey: "calendar") ?? ""]
    req.httpBody = try JSONSerialization.data(withJSONObject: body)
    let data: Data, resp: URLResponse
    do { (data, resp) = try await URLSession.shared.data(for: req) } catch { throw JarvisError.network("réseau") }
    let j = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any]) ?? [:]
    let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
    if code == 401 { throw JarvisError.notLogged }
    if code != 200 { throw JarvisError.network((j["error"] as? String) ?? "erreur \(code)") }
    let reply = ((j["reply"] as? String) ?? "").isEmpty ? "C'est fait." : (j["reply"] as! String)
    let actions = (j["actions"] as? [[String: Any]]) ?? []
    // actions en attente : l'app les applique dès qu'elle tourne (même en arrière-plan)
    var pending = (d.array(forKey: "pending") as? [Data]) ?? []
    if let item = try? JSONSerialization.data(withJSONObject: ["text": text, "reply": reply, "actions": actions, "at": Date().timeIntervalSince1970 * 1000]) { pending.append(item) }
    d.set(Array(pending.suffix(30)), forKey: "pending")
    var log = (d.array(forKey: "siriLog") as? [[String: String]]) ?? []
    log += [["role": "user", "content": text], ["role": "assistant", "content": reply]]
    d.set(Array(log.suffix(10)), forKey: "siriLog")
    return reply
  }
}

struct AskJarvisIntent: AppIntent {
  static var title: LocalizedStringResource = "Demander à Jarvis"
  static var description = IntentDescription("Parlez à Jarvis sans ouvrir l'app : une dépense, un repas, une tâche, une question.")
  static var openAppWhenRun = false
  @Parameter(title: "Demande", requestValueDialog: "Oui, Monsieur ?") var text: String
  func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
    let reply = try await JarvisRemote.ask(text)
    #if !WIDGET
    deliverToWeb("pending")   // app lancée en arrière-plan : les actions sont appliquées tout de suite
    #endif
    return .result(value: reply, dialog: IntentDialog(stringLiteral: reply))
  }
}

struct BriefingIntent: AppIntent {
  static var title: LocalizedStringResource = "Briefing de Jarvis"
  static var description = IntentDescription("Jarvis vous fait le point de la journée, sans ouvrir l'app.")
  static var openAppWhenRun = false
  func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
    let t = JarvisRemote.defaults?.string(forKey: "briefing") ?? ""
    let text = t.isEmpty ? "Ouvrez Jarvis une fois pour que je prépare votre briefing." : t
    return .result(value: text, dialog: IntentDialog(stringLiteral: text))
  }
}
