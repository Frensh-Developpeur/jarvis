// Données partagées entre l'app et ses widgets (groupe d'apps)
import Foundation

let APP_GROUP = "group.com.sebckyser.jarvis"

struct WidgetData: Codable {
  var steps: Double = 0, stepGoal: Double = 10000, energy: Double = 0
  var kcal: Double = 0, kcalGoal: Double = 0, prot: Double = 0, protGoal: Double = 0
  var tasksLeft: Int = 0, overdue: Int = 0, nextTask: String? = nil, nextTime: String? = nil
  var week: Int = 0, weekGoal: Int = 3
  var sleep: Double? = nil
  var name: String = "Monsieur"
  var updatedAt: Double = 0

  static func load() -> WidgetData {
    guard let d = UserDefaults(suiteName: APP_GROUP)?.data(forKey: "widget"), let w = try? JSONDecoder().decode(WidgetData.self, from: d) else { return WidgetData() }
    return w
  }
  static var sample: WidgetData {
    var w = WidgetData(); w.steps = 7420; w.energy = 380; w.kcal = 1240; w.kcalGoal = 2300; w.prot = 92; w.protGoal = 150
    w.tasksLeft = 3; w.nextTask = "Appeler le garage"; w.nextTime = "18:00"; w.week = 2; w.weekGoal = 4; w.sleep = 7.2; return w
  }
}
