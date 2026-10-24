import Foundation
import SwiftData

/// A habit the user wants to repeat every day, e.g. "Drink water" eight times a day.
@Model
final class Habit {
    var id: UUID = UUID()
    var name: String = ""
    var symbolName: String = "checkmark"
    var colorName: String = HabitColor.blue.rawValue
    var targetPerDay: Int = 1
    var createdAt: Date = Date.now
    var sortOrder: Int = 0
    var reminderEnabled: Bool = false
    var reminderHour: Int = 9
    var reminderMinute: Int = 0

    @Relationship(deleteRule: .cascade, inverse: \HabitLog.habit)
    var logs: [HabitLog] = []

    init(
        name: String,
        symbolName: String,
        colorName: String,
        targetPerDay: Int = 1,
        createdAt: Date = .now,
        sortOrder: Int = 0,
        reminderEnabled: Bool = false,
        reminderHour: Int = 9,
        reminderMinute: Int = 0
    ) {
        self.id = UUID()
        self.name = name
        self.symbolName = symbolName
        self.colorName = colorName
        self.targetPerDay = max(1, targetPerDay)
        self.createdAt = createdAt
        self.sortOrder = sortOrder
        self.reminderEnabled = reminderEnabled
        self.reminderHour = reminderHour
        self.reminderMinute = reminderMinute
    }
}

/// How many times a habit was done on a given calendar day.
@Model
final class HabitLog {
    /// Start of the local calendar day.
    var day: Date = Date.now
    var count: Int = 0
    var habit: Habit?

    init(day: Date, count: Int) {
        self.day = Calendar.current.startOfDay(for: day)
        self.count = count
    }
}
