// Widgets Jarvis : écran d'accueil (petit, moyen) et écran verrouillé (cercle, rectangle, ligne)
import WidgetKit
import SwiftUI
import AppIntents

struct Entry: TimelineEntry { let date: Date; let d: WidgetData }

struct Provider: TimelineProvider {
  func placeholder(in c: Context) -> Entry { Entry(date: .now, d: .sample) }
  func getSnapshot(in c: Context, completion: @escaping (Entry) -> Void) { completion(Entry(date: .now, d: c.isPreview ? .sample : WidgetData.load())) }
  func getTimeline(in c: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    // l'app redemande un rafraîchissement à chaque changement ; sinon on relit toutes les 30 min
    completion(Timeline(entries: [Entry(date: .now, d: WidgetData.load())], policy: .after(.now.addingTimeInterval(1800))))
  }
}

// ---------- palette ----------
let cyan = Color(red: 0.25, green: 0.88, blue: 1)
let mint = Color(red: 0.30, green: 1, blue: 0.76)
let gold = Color(red: 1, green: 0.70, blue: 0.28)
let bg = LinearGradient(colors: [Color(red: 0.03, green: 0.10, blue: 0.16), Color(red: 0.008, green: 0.024, blue: 0.047)], startPoint: .top, endPoint: .bottom)
func fmt(_ v: Double) -> String { let f = NumberFormatter(); f.numberStyle = .decimal; f.locale = Locale(identifier: "fr_FR"); f.maximumFractionDigits = 0; return f.string(from: NSNumber(value: v)) ?? "\(Int(v))" }

struct Ring: View {
  var value: Double; var color: Color; var width: CGFloat = 7
  var body: some View {
    ZStack {
      Circle().stroke(color.opacity(0.15), lineWidth: width)
      Circle().trim(from: 0, to: min(1, max(0.001, value))).stroke(color, style: StrokeStyle(lineWidth: width, lineCap: .round))
        .rotationEffect(.degrees(-90)).shadow(color: color.opacity(0.7), radius: 4)
    }
  }
}

// ---------- écran d'accueil ----------
struct SmallView: View {
  let d: WidgetData
  var body: some View {
    let left = max(0, d.kcalGoal - d.kcal)
    VStack(alignment: .leading, spacing: 6) {
      HStack { Text("J.A.R.V.I.S.").font(.system(size: 10, weight: .heavy, design: .rounded)).kerning(1.5).foregroundStyle(cyan); Spacer() }
      ZStack {
        Ring(value: d.kcalGoal > 0 ? d.kcal / d.kcalGoal : 0, color: mint, width: 8)
        Ring(value: d.steps / max(1, d.stepGoal), color: cyan, width: 6).padding(12)
        VStack(spacing: 0) {
          Text(fmt(left)).font(.system(size: 19, weight: .bold, design: .rounded)).foregroundStyle(.white).minimumScaleFactor(0.6)
          Text("kcal restantes").font(.system(size: 8, weight: .medium)).foregroundStyle(.white.opacity(0.6))
        }
      }
      HStack(spacing: 4) {
        Image(systemName: "figure.walk").font(.system(size: 9)).foregroundStyle(cyan)
        Text("\(fmt(d.steps)) pas").font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.85))
      }
    }
    .widgetURL(URL(string: "jarvis://nutrition"))
  }
}

struct MediumView: View {
  let d: WidgetData
  var body: some View {
    HStack(spacing: 14) {
      VStack(spacing: 8) {
        stat(ring: d.steps / max(1, d.stepGoal), color: cyan, icon: "figure.walk", value: fmt(d.steps), label: "pas")
        stat(ring: d.kcalGoal > 0 ? d.kcal / d.kcalGoal : 0, color: mint, icon: "fork.knife", value: fmt(max(0, d.kcalGoal - d.kcal)), label: "kcal rest.")
      }
      .frame(maxWidth: 120)
      VStack(alignment: .leading, spacing: 7) {
        Text("J.A.R.V.I.S.").font(.system(size: 10, weight: .heavy, design: .rounded)).kerning(1.5).foregroundStyle(cyan)
        if let t = d.nextTask {
          VStack(alignment: .leading, spacing: 2) {
            Text(d.nextTime.map { "PROCHAINE · \($0.replacingOccurrences(of: ":", with: "h"))" } ?? "À FAIRE").font(.system(size: 9, weight: .bold)).foregroundStyle(.white.opacity(0.5))
            Text(t).font(.system(size: 14, weight: .semibold)).foregroundStyle(.white).lineLimit(2)
          }
        } else {
          Text(d.tasksLeft == 0 ? "Tout est fait." : "\(d.tasksLeft) tâche\(d.tasksLeft > 1 ? "s" : "") aujourd'hui").font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
        }
        Spacer(minLength: 0)
        HStack(spacing: 10) {
          chip(icon: "checklist", text: d.overdue > 0 ? "\(d.overdue) en retard" : "\(d.tasksLeft) à faire", color: d.overdue > 0 ? gold : .white.opacity(0.7))
          chip(icon: "dumbbell.fill", text: "\(d.week)/\(d.weekGoal)", color: gold)
          if let s = d.sleep { chip(icon: "moon.fill", text: String(format: "%.1f h", s).replacingOccurrences(of: ".", with: ","), color: Color(red: 0.72, green: 0.55, blue: 1)) }
        }
      }
      Spacer(minLength: 0)
    }
    .widgetURL(URL(string: "jarvis://"))
  }
  func stat(ring: Double, color: Color, icon: String, value: String, label: String) -> some View {
    HStack(spacing: 8) {
      ZStack { Ring(value: ring, color: color, width: 5); Image(systemName: icon).font(.system(size: 11, weight: .bold)).foregroundStyle(color) }.frame(width: 38, height: 38)
      VStack(alignment: .leading, spacing: 0) {
        Text(value).font(.system(size: 15, weight: .bold, design: .rounded)).foregroundStyle(.white).minimumScaleFactor(0.7)
        Text(label).font(.system(size: 9)).foregroundStyle(.white.opacity(0.55))
      }
      Spacer(minLength: 0)
    }
  }
  func chip(icon: String, text: String, color: Color) -> some View {
    HStack(spacing: 3) { Image(systemName: icon).font(.system(size: 9)); Text(text).font(.system(size: 10, weight: .semibold)) }.foregroundStyle(color)
  }
}

// ---------- écran verrouillé ----------
struct CircularView: View {
  let d: WidgetData
  var body: some View {
    Gauge(value: min(1, d.steps / max(1, d.stepGoal))) { Image(systemName: "figure.walk") } currentValueLabel: { Text(d.steps >= 1000 ? "\(Int(d.steps / 1000))k" : fmt(d.steps)) }
      .gaugeStyle(.accessoryCircularCapacity).widgetURL(URL(string: "jarvis://sante"))
  }
}
struct RectView: View {
  let d: WidgetData
  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      if let t = d.nextTask {
        Text(d.nextTime.map { "⏰ \($0.replacingOccurrences(of: ":", with: "h"))" } ?? "À faire").font(.system(size: 12, weight: .bold))
        Text(t).font(.system(size: 13)).lineLimit(1)
      } else {
        Text("\(fmt(max(0, d.kcalGoal - d.kcal))) kcal restantes").font(.system(size: 13, weight: .semibold))
      }
      Text("\(fmt(d.steps)) pas · \(d.tasksLeft) tâche\(d.tasksLeft > 1 ? "s" : "")").font(.system(size: 11)).foregroundStyle(.secondary)
    }.widgetURL(URL(string: d.nextTask != nil ? "jarvis://taches" : "jarvis://nutrition"))
  }
}

struct WidgetView: View {
  @Environment(\.widgetFamily) var family
  let e: Entry
  var body: some View {
    switch family {
    case .accessoryCircular: CircularView(d: e.d).containerBackground(.clear, for: .widget)
    case .accessoryRectangular: RectView(d: e.d).containerBackground(.clear, for: .widget)
    case .accessoryInline: Text("🚶 \(fmt(e.d.steps)) · 🍽 \(fmt(max(0, e.d.kcalGoal - e.d.kcal))) kcal").containerBackground(.clear, for: .widget)
    case .systemMedium: MediumView(d: e.d).containerBackground(bg, for: .widget)
    default: SmallView(d: e.d).containerBackground(bg, for: .widget)
    }
  }
}

// ---------- réacteur : un toucher et Jarvis écoute ----------
struct ReactorView: View {
  @Environment(\.widgetFamily) var family
  var body: some View {
    ZStack {
      Circle().stroke(cyan.opacity(0.25), style: StrokeStyle(lineWidth: 2, dash: [1, 5]))
      Circle().trim(from: 0.05, to: 0.95).stroke(cyan.opacity(0.7), style: StrokeStyle(lineWidth: 3, lineCap: .round, dash: [18, 6, 4, 6])).padding(8).rotationEffect(.degrees(20))
      Circle().stroke(cyan.opacity(0.35), lineWidth: 1).padding(20)
      Circle().fill(RadialGradient(colors: [Color(red: 0.75, green: 0.97, blue: 1), cyan, cyan.opacity(0.15)], center: .center, startRadius: 1, endRadius: family == .accessoryCircular ? 14 : 30))
        .padding(family == .accessoryCircular ? 14 : 30).shadow(color: cyan, radius: 10)
      if family != .accessoryCircular {
        VStack { Spacer(); Text("JARVIS").font(.system(size: 10, weight: .heavy, design: .rounded)).kerning(2.5).foregroundStyle(cyan) }.padding(.bottom, 2)
      }
    }
    .widgetURL(URL(string: "jarvis://listen"))
  }
}
struct ReactorWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "JarvisReactor", provider: Provider()) { _ in
      ReactorView().containerBackground(for: .widget) { bg }
    }
    .configurationDisplayName("Réacteur Jarvis")
    .description("Touchez le réacteur : Jarvis vous écoute.")
    .supportedFamilies([.systemSmall, .accessoryCircular])
  }
}

// ---------- Centre de contrôle, écran verrouillé, bouton Action (iOS 18) ----------
@available(iOS 18.0, *)
struct JarvisControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "com.sebckyser.jarvis.listen") {
      ControlWidgetButton(action: AskJarvisIntent()) {
        Label("Jarvis", systemImage: "circle.hexagongrid.circle.fill")
      }
    }
    .displayName("Parler à Jarvis")
    .description("Parlez à Jarvis sans ouvrir l'app.")
  }
}

@available(iOS 18.0, *)
struct JarvisOpenControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "com.sebckyser.jarvis.open") {
      ControlWidgetButton(action: OpenURLIntent(URL(string: "jarvis://listen")!)) { Label("Jarvis (app)", systemImage: "waveform.circle") }
    }
    .displayName("Ouvrir Jarvis en écoute")
    .description("Ouvre l'app Jarvis, micro allumé.")
  }
}

@main
struct JarvisWidgets: WidgetBundle {
  var body: some Widget {
    JarvisWidget()
    ReactorWidget()
    if #available(iOS 18.0, *) { JarvisControl(); JarvisOpenControl() }
  }
}

struct JarvisWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "JarvisWidget", provider: Provider()) { WidgetView(e: $0) }
      .configurationDisplayName("Jarvis")
      .description("Pas, calories restantes, prochaine tâche et séances de la semaine.")
      .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
  }
}
