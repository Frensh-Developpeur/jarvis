// Jarvis agit sur le téléphone : photos (recherche IA sur l'appareil), contacts, appels, SMS, itinéraires,
// ouverture d'apps, lampe, luminosité, volume, réveils (AlarmKit), modes Concentration (via Raccourcis).
import UIKit
import Photos
import Vision
import Contacts
import MessageUI
import MediaPlayer
import AVFoundation
import CoreLocation
import AlarmKit
import SwiftUI

// MARK: - Index des photos (analyse sur l'appareil, rien n'est envoyé)
final class PhotoIndex {
  static let shared = PhotoIndex()
  struct Item: Codable { var d: Double; var l: [String]; var t: String; var lat: Double?; var lon: Double? }
  private var items: [String: Item] = [:]
  private let lock = NSLock()
  private(set) var running = false
  private var loaded = false
  private var url: URL { FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("photo-index.json") }

  private func load() {
    guard !loaded else { return }; loaded = true
    if let d = try? Data(contentsOf: url), let x = try? JSONDecoder().decode([String: Item].self, from: d) { lock.lock(); items = x; lock.unlock() }
  }
  private func save() {
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    lock.lock(); let snap = items; lock.unlock()
    if let d = try? JSONEncoder().encode(snap) { try? d.write(to: url, options: .atomic) }
  }
  var count: Int { load(); lock.lock(); defer { lock.unlock() }; return items.count }
  var authorized: Bool { let s = PHPhotoLibrary.authorizationStatus(for: .readWrite); return s == .authorized || s == .limited }
  func authorize(_ done: @escaping (Bool) -> Void) { PHPhotoLibrary.requestAuthorization(for: .readWrite) { s in done(s == .authorized || s == .limited) } }

  /// analyse les photos pas encore indexées, des plus récentes aux plus anciennes
  func build(progress: @escaping (Int, Int) -> Void) {
    guard authorized, !running else { return }
    running = true; load()
    DispatchQueue.global(qos: .utility).async {
      let opts = PHFetchOptions(); opts.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
      let assets = PHAsset.fetchAssets(with: .image, options: opts), total = assets.count
      var todo: [PHAsset] = []
      self.lock.lock(); let known = Set(self.items.keys); self.lock.unlock()
      assets.enumerateObjects { a, _, _ in if !known.contains(a.localIdentifier) { todo.append(a) } }
      let mgr = PHImageManager.default(), ro = PHImageRequestOptions()
      ro.isSynchronous = true; ro.deliveryMode = .fastFormat; ro.resizeMode = .fast; ro.isNetworkAccessAllowed = false
      var n = 0
      for a in todo {
        autoreleasepool {
          var img: CGImage?
          mgr.requestImage(for: a, targetSize: CGSize(width: 400, height: 400), contentMode: .aspectFit, options: ro) { im, _ in img = im?.cgImage }
          var labels: [String] = [], text = ""
          if let cg = img {
            let cls = VNClassifyImageRequest(), ocr = VNRecognizeTextRequest()
            ocr.recognitionLevel = .fast; ocr.recognitionLanguages = ["fr-FR", "en-US"]
            try? VNImageRequestHandler(cgImage: cg).perform([cls, ocr])
            labels = (cls.results ?? []).filter { $0.confidence > 0.2 }.prefix(14).map { $0.identifier }
            text = String((ocr.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ").prefix(400))
          }
          let it = Item(d: (a.creationDate ?? Date()).timeIntervalSince1970 * 1000, l: labels, t: text, lat: a.location?.coordinate.latitude, lon: a.location?.coordinate.longitude)
          self.lock.lock(); self.items[a.localIdentifier] = it; self.lock.unlock()
          n += 1
          if n % 60 == 0 { self.save(); progress(self.count, total) }
        }
      }
      self.save(); self.running = false; progress(self.count, total)
    }
  }

  /// recherche : étiquettes de scène (anglais), mots lus dans l'image, période, lieu
  func search(labels: [String], words: [String], from: Double?, to: Double?, near: CLLocation?, limit: Int = 36) -> [String] {
    load()
    lock.lock(); let all = items; lock.unlock()
    let L = labels.map { $0.lowercased() }, W = words.map { $0.lowercased() }.filter { $0.count > 2 }
    var scored: [(String, Double, Double)] = []
    for (id, it) in all {
      if let f = from, it.d < f { continue }
      if let t = to, it.d > t { continue }
      if let p = near { guard let la = it.lat, let lo = it.lon, CLLocation(latitude: la, longitude: lo).distance(from: p) < 30000 else { continue } }
      var s = 0.0
      for q in L { if let i = it.l.firstIndex(where: { $0.lowercased() == q || $0.lowercased().hasPrefix(q + "_") || $0.lowercased().hasSuffix("_" + q) || $0.lowercased().contains(q) }) { s += 3 + max(0, 2 - Double(i) * 0.2) } }
      let txt = it.t.lowercased()
      for w in W where txt.contains(w) { s += 4 }
      if L.isEmpty && W.isEmpty { s = 1 }          // seulement une période ou un lieu
      else if !L.isEmpty && s < 3 && W.isEmpty { continue }
      if s > 0 { scored.append((id, s, it.d)) }
    }
    return scored.sorted { $0.1 != $1.1 ? $0.1 > $1.1 : $0.2 > $1.2 }.prefix(limit).map { $0.0 }
  }

  static func thumbs(_ ids: [String], size: CGFloat = 260) -> [[String: Any]] {
    let assets = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
    var byId = [String: PHAsset](); assets.enumerateObjects { a, _, _ in byId[a.localIdentifier] = a }
    let ro = PHImageRequestOptions(); ro.isSynchronous = true; ro.deliveryMode = .opportunistic; ro.resizeMode = .fast; ro.isNetworkAccessAllowed = true
    return ids.compactMap { id in
      guard let a = byId[id] else { return nil }
      var out: String?
      PHImageManager.default().requestImage(for: a, targetSize: CGSize(width: size, height: size), contentMode: .aspectFill, options: ro) { im, _ in
        if let d = im?.jpegData(compressionQuality: 0.6) { out = "data:image/jpeg;base64," + d.base64EncodedString() }
      }
      guard let src = out else { return nil }
      return ["id": id, "src": src, "date": (a.creationDate ?? Date()).timeIntervalSince1970 * 1000]
    }
  }
}

// MARK: - Visionneuse plein écran (zoom, partager)
final class PhotoViewer: UIViewController, UIScrollViewDelegate {
  let id: String; let scroll = UIScrollView(); let imageView = UIImageView()
  init(id: String) { self.id = id; super.init(nibName: nil, bundle: nil); modalPresentationStyle = .fullScreen }
  required init?(coder: NSCoder) { fatalError() }
  override func viewDidLoad() {
    super.viewDidLoad(); view.backgroundColor = .black
    scroll.frame = view.bounds; scroll.autoresizingMask = [.flexibleWidth, .flexibleHeight]; scroll.delegate = self; scroll.maximumZoomScale = 5
    imageView.frame = scroll.bounds; imageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]; imageView.contentMode = .scaleAspectFit
    scroll.addSubview(imageView); view.addSubview(scroll)
    let close = UIButton(type: .system), share = UIButton(type: .system)
    close.setImage(UIImage(systemName: "xmark.circle.fill"), for: .normal); share.setImage(UIImage(systemName: "square.and.arrow.up.circle.fill"), for: .normal)
    [close, share].forEach { $0.tintColor = UIColor(red: 0.25, green: 0.88, blue: 1, alpha: 1); $0.setPreferredSymbolConfiguration(.init(pointSize: 30), forImageIn: .normal); $0.translatesAutoresizingMaskIntoConstraints = false; view.addSubview($0) }
    NSLayoutConstraint.activate([close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8), close.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
                                 share.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8), share.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16)])
    close.addAction(UIAction { [weak self] _ in self?.dismiss(animated: true) }, for: .touchUpInside)
    share.addAction(UIAction { [weak self] _ in
      guard let self, let im = self.imageView.image else { return }
      self.present(UIActivityViewController(activityItems: [im], applicationActivities: nil), animated: true)
    }, for: .touchUpInside)
    guard let a = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else { return }
    let ro = PHImageRequestOptions(); ro.isNetworkAccessAllowed = true; ro.deliveryMode = .highQualityFormat
    PHImageManager.default().requestImage(for: a, targetSize: PHImageManagerMaximumSize, contentMode: .aspectFit, options: ro) { [weak self] im, _ in self?.imageView.image = im }
  }
  func viewForZooming(in s: UIScrollView) -> UIView? { imageView }
}

// MARK: - Réveils (iOS 26 : sonnent même en silencieux)
@available(iOS 26.0, *)
struct JarvisAlarmMeta: AlarmMetadata {}

// MARK: - Actions sur le téléphone
final class DeviceBridge: NSObject, MFMessageComposeViewControllerDelegate {
  weak var web: WebController?
  private var smsDone: ((Bool, Any?) -> Void)?
  private lazy var volumeView: MPVolumeView = { let v = MPVolumeView(frame: CGRect(x: -2000, y: -2000, width: 10, height: 10)); v.alpha = 0.01; return v }()

  func handle(_ name: String, _ a: [String: Any], _ done: @escaping (Bool, Any?) -> Void) -> Bool {
    switch name {
    // ---- photos ----
    case "photos.status": done(true, ["authorized": PhotoIndex.shared.authorized, "count": PhotoIndex.shared.count, "running": PhotoIndex.shared.running])
    case "photos.index":
      PhotoIndex.shared.authorize { ok in
        guard ok else { return done(false, "Accès aux photos refusé : Réglages › Jarvis › Photos") }
        PhotoIndex.shared.build { n, total in self.web?.emit("photos.progress", ["count": n, "total": total]) }
        done(true, ["count": PhotoIndex.shared.count])
      }
    case "photos.search":
      let labels = (a["labels"] as? [String]) ?? [], words = (a["words"] as? [String]) ?? []
      let from = a["from"] as? Double, to = a["to"] as? Double, place = (a["place"] as? String) ?? ""
      let run = { (near: CLLocation?) in
        DispatchQueue.global(qos: .userInitiated).async {
          let ids = PhotoIndex.shared.search(labels: labels, words: words, from: from, to: to, near: near)
          done(true, ["items": PhotoIndex.thumbs(ids), "indexed": PhotoIndex.shared.count, "running": PhotoIndex.shared.running])
        }
      }
      if place.isEmpty { run(nil) } else { CLGeocoder().geocodeAddressString(place) { pm, _ in run(pm?.first?.location) } }
    case "photos.open":
      DispatchQueue.main.async { self.web?.present(PhotoViewer(id: a["id"] as? String ?? ""), animated: true); done(true, nil) }
    // ---- contacts, appels, SMS, itinéraires, apps ----
    case "contacts.find": findContacts(a["name"] as? String ?? "", done)
    case "call":
      let num = (a["number"] as? String ?? "").filter { "+0123456789".contains($0) }
      guard !num.isEmpty, let url = URL(string: "tel://" + num) else { done(false, "Numéro invalide"); return true }
      DispatchQueue.main.async { UIApplication.shared.open(url) { ok in done(ok, nil) } }
    case "sms":
      DispatchQueue.main.async {
        guard MFMessageComposeViewController.canSendText() else { return done(false, "Messages indisponible") }
        let vc = MFMessageComposeViewController(); vc.recipients = [a["number"] as? String ?? ""]; vc.body = a["body"] as? String ?? ""
        vc.messageComposeDelegate = self; self.smsDone = done; self.web?.present(vc, animated: true)
      }
    case "open.url":
      guard let s = a["url"] as? String, let url = URL(string: s) else { done(false, "Lien invalide"); return true }
      DispatchQueue.main.async { UIApplication.shared.open(url) { ok in done(ok, ok ? nil : "Impossible d'ouvrir \(url.scheme ?? "")") } }
    // ---- lampe, luminosité, volume ----
    case "torch":
      guard let dev = AVCaptureDevice.default(for: .video), dev.hasTorch else { done(false, "Pas de lampe"); return true }
      do {
        try dev.lockForConfiguration()
        if a["on"] as? Bool == false { dev.torchMode = .off } else { try dev.setTorchModeOn(level: Float(max(0.05, min(1, (a["level"] as? Double ?? 100) / 100)))) }
        dev.unlockForConfiguration(); done(true, nil)
      } catch { done(false, error.localizedDescription) }
    case "brightness":
      DispatchQueue.main.async { UIScreen.main.brightness = CGFloat(max(0, min(1, (a["level"] as? Double ?? 50) / 100))); done(true, nil) }
    case "volume":
      DispatchQueue.main.async {
        if self.volumeView.superview == nil { self.web?.view.addSubview(self.volumeView) }
        let level = Float(max(0, min(1, (a["level"] as? Double ?? 50) / 100)))
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
          (self.volumeView.subviews.first { $0 is UISlider } as? UISlider)?.setValue(level, animated: false)
          done(true, nil)
        }
      }
    // ---- réveil ----
    case "alarm": scheduleAlarm(a, done)
    default: return false
    }
    return true
  }

  func messageComposeViewController(_ c: MFMessageComposeViewController, didFinishWith r: MessageComposeResult) {
    c.dismiss(animated: true); smsDone?(true, r == .sent ? "sent" : r == .cancelled ? "cancelled" : "failed"); smsDone = nil
  }

  private func findContacts(_ q: String, _ done: @escaping (Bool, Any?) -> Void) {
    let store = CNContactStore()
    store.requestAccess(for: .contacts) { ok, _ in
      guard ok else { return done(false, "Accès aux contacts refusé : Réglages › Jarvis › Contacts") }
      let keys = [CNContactGivenNameKey, CNContactFamilyNameKey, CNContactNicknameKey, CNContactPhoneNumbersKey, CNContactOrganizationNameKey] as [CNKeyDescriptor]
      var out = [[String: Any]](), seen = Set<String>()
      let norm = { (s: String) in s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current) }
      let nq = norm(q)
      let add = { (c: CNContact) in
        guard !seen.contains(c.identifier), !c.phoneNumbers.isEmpty else { return }
        seen.insert(c.identifier)
        let name = [c.givenName, c.familyName].filter { !$0.isEmpty }.joined(separator: " ")
        out.append(["name": name.isEmpty ? (c.nickname.isEmpty ? c.organizationName : c.nickname) : name,
                    "phones": c.phoneNumbers.map { ["label": CNLabeledValue<NSString>.localizedString(forLabel: $0.label ?? ""), "number": $0.value.stringValue] }])
      }
      try? store.unifiedContacts(matching: CNContact.predicateForContacts(matchingName: q), keysToFetch: keys).forEach(add)
      if out.isEmpty {   // surnoms (« Maman »), prénoms approchants
        try? store.enumerateContacts(with: CNContactFetchRequest(keysToFetch: keys)) { c, _ in
          if norm(c.nickname).contains(nq) || norm(c.givenName + " " + c.familyName).contains(nq) { add(c) }
        }
      }
      done(true, Array(out.prefix(8)))
    }
  }

  private func scheduleAlarm(_ a: [String: Any], _ done: @escaping (Bool, Any?) -> Void) {
    guard let at = a["at"] as? Double else { return done(false, "Heure manquante") }
    let label = (a["label"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Réveil Jarvis"
    guard #available(iOS 26.0, *) else { return done(false, "Réveils : iOS 26 requis") }
    Task {
      do {
        let state = try await AlarmManager.shared.requestAuthorization()
        guard state == .authorized else { return done(false, "Réveils refusés : Réglages › Jarvis › Alarmes") }
        let alert = AlarmPresentation.Alert(title: LocalizedStringResource(stringLiteral: label), stopButton: AlarmButton(text: "Arrêter", textColor: .white, systemImageName: "stop.circle"))
        let attrs = AlarmAttributes<JarvisAlarmMeta>(presentation: AlarmPresentation(alert: alert), tintColor: Color(red: 0.25, green: 0.88, blue: 1))
        let config = AlarmManager.AlarmConfiguration<JarvisAlarmMeta>.alarm(schedule: .fixed(Date(timeIntervalSince1970: at / 1000)), attributes: attrs)
        _ = try await AlarmManager.shared.schedule(id: UUID(), configuration: config)
        done(true, nil)
      } catch { done(false, error.localizedDescription) }
    }
  }
}
