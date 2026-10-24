import Foundation
import SwiftData
import SwiftUI

extension Habit {
    var color: Color { HabitColor(rawValue: colorName)?.color ?? .accentColor }

    func log(on day: Date) -> HabitLog? {
        let calendar = Calendar.current
        return logs.first { calendar.isDate($0.day, inSameDayAs: day) }
    }

    func count(on day: Date) -> Int { log(on: day)?.count ?? 0 }

    func progress(on day: Date) -> Double {
        min(1, Double(count(on: day)) / Double(max(targetPerDay, 1)))
    }

    func isComplete(on day: Date) -> Bool { count(on: day) >= targetPerDay }

    /// Whether the habit already existed on `day`.
    func exists(on day: Date) -> Bool {
        Calendar.current.startOfDay(for: createdAt) <= Calendar.current.startOfDay(for: day)
    }

    var completedDays: Set<Date> {
        let calendar = Calendar.current
        return Set(logs.filter { $0.count >= targetPerDay }.map { calendar.startOfDay(for: $0.day) })
    }

    /// Consecutive completed days ending today (or yesterday, if today is still open).
    var currentStreak: Int {
        let calendar = Calendar.current
        let days = completedDays
        var day = calendar.startOfDay(for: .now)
        if !days.contains(day), let yesterday = calendar.date(byAdding: .day, value: -1, to: day) {
            day = yesterday
        }
        var streak = 0
        while days.contains(day) {
            streak += 1
            guard let previous = calendar.date(byAdding: .day, value: -1, to: day) else { break }
            day = previous
        }
        return streak
    }

    var bestStreak: Int {
        let calendar = Calendar.current
        var best = 0
        var run = 0
        var previous: Date?
        for day in completedDays.sorted() {
            if let previous, calendar.date(byAdding: .day, value: 1, to: previous) == day {
                run += 1
            } else {
                run = 1
            }
            best = max(best, run)
            previous = day
        }
        return best
    }

    /// Share of completed days over the last `days` days (only counting days the habit existed).
    func completionRate(days: Int) -> Double {
        let calendar = Calendar.current
        let completed = completedDays
        let today = calendar.startOfDay(for: .now)
        var total = 0
        var done = 0
        for offset in 0..<days {
            guard let day = calendar.date(byAdding: .day, value: -offset, to: today), exists(on: day) else { break }
            total += 1
            if completed.contains(day) { done += 1 }
        }
        return total == 0 ? 0 : Double(done) / Double(total)
    }

    /// Adds one check-in for today. Tapping a finished habit resets it to zero.
    @MainActor
    func registerCheckIn(on day: Date = .now) {
        if let log = log(on: day) {
            log.count = log.count >= targetPerDay ? 0 : log.count + 1
        } else {
            logs.append(HabitLog(day: day, count: 1))
        }
    }
}
