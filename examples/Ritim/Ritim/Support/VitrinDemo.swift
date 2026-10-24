import Foundation
import SwiftData

// MARK: - Vitrin demo mode
//
// Ritim is the end-to-end fixture for Vitrin, a CLI that captures App Store
// screenshots in the simulator. Vitrin launches the app with these arguments:
//
//   -VitrinDemo             Use an in-memory SwiftData store seeded with realistic
//                           demo habits (~12 weeks of history). Habit names follow the
//                           current app language because they come from the String Catalog.
//                           No permission prompts or StoreKit calls happen in this mode.
//   -VitrinScreen <id>      Open a screen directly at launch. Valid ids:
//                           home, stats, detail, reminders, add, paywall
//
// Language/region are set the standard way, e.g. `-AppleLanguages (tr) -AppleLocale tr_TR`.
//
// Example:
//   xcrun simctl launch booted com.jastech.ritim -VitrinDemo -VitrinScreen stats \
//       -AppleLanguages "(tr)" -AppleLocale tr_TR

/// Screen identifiers accepted by `-VitrinScreen`.
enum VitrinScreen: String, CaseIterable, Sendable {
    case home, stats, detail, reminders, add, paywall
}

enum VitrinDemo {
    static let isActive: Bool = ProcessInfo.processInfo.arguments.contains("-VitrinDemo")

    static let requestedScreen: VitrinScreen? = {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-VitrinScreen"), index + 1 < arguments.count else {
            return nil
        }
        return VitrinScreen(rawValue: arguments[index + 1].lowercased())
    }()

    /// Number of days of history generated for every demo habit.
    static let historyDays = 84

    @MainActor
    static func makeContainer() -> ModelContainer {
        let configuration = ModelConfiguration(isStoredInMemoryOnly: true)
        do {
            let container = try ModelContainer(for: Habit.self, HabitLog.self, configurations: configuration)
            seed(into: container.mainContext)
            return container
        } catch {
            fatalError("Could not create the demo store: \(error)")
        }
    }

    private struct Spec {
        let name: LocalizedStringResource
        let symbol: String
        let color: HabitColor
        let target: Int
        /// Chance that a past day was completed.
        let consistency: Double
        /// Days completed in a row up to yesterday.
        let streak: Int
        let todayCount: Int
        let reminder: (hour: Int, minute: Int)?
    }

    private static let specs: [Spec] = [
        Spec(name: "Drink water", symbol: "drop.fill", color: .blue, target: 8,
             consistency: 0.82, streak: 12, todayCount: 6, reminder: (9, 0)),
        Spec(name: "Morning run", symbol: "figure.run", color: .coral, target: 1,
             consistency: 0.68, streak: 5, todayCount: 1, reminder: (7, 0)),
        Spec(name: "Read 20 pages", symbol: "book.fill", color: .purple, target: 1,
             consistency: 0.80, streak: 23, todayCount: 1, reminder: (21, 30)),
        Spec(name: "Meditate", symbol: "leaf.fill", color: .mint, target: 1,
             consistency: 0.88, streak: 41, todayCount: 1, reminder: (8, 0)),
        Spec(name: "No added sugar", symbol: "carrot.fill", color: .orange, target: 1,
             consistency: 0.64, streak: 3, todayCount: 0, reminder: nil),
        Spec(name: "Practice Spanish", symbol: "character.bubble.fill", color: .teal, target: 1,
             consistency: 0.74, streak: 9, todayCount: 0, reminder: (19, 0)),
        Spec(name: "Lights out by 11 PM", symbol: "moon.stars.fill", color: .indigo, target: 1,
             consistency: 0.70, streak: 7, todayCount: 0, reminder: (22, 30)),
    ]

    @MainActor
    static func seed(into context: ModelContext) {
        var random = SplitMix64(seed: 0x52_49_54_49_4D) // "RITIM"
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: .now)
        let start = calendar.date(byAdding: .day, value: -historyDays, to: today) ?? today

        for (index, spec) in specs.enumerated() {
            let habit = Habit(
                name: String(localized: spec.name),
                symbolName: spec.symbol,
                colorName: spec.color.rawValue,
                targetPerDay: spec.target,
                createdAt: start,
                sortOrder: index,
                reminderEnabled: spec.reminder != nil,
                reminderHour: spec.reminder?.hour ?? 9,
                reminderMinute: spec.reminder?.minute ?? 0
            )
            context.insert(habit)

            for offset in 0...historyDays {
                guard let day = calendar.date(byAdding: .day, value: -offset, to: today) else { continue }
                let count: Int
                if offset == 0 {
                    count = spec.todayCount
                } else if offset <= spec.streak {
                    count = spec.target
                } else if offset == spec.streak + 1 {
                    count = spec.target / 2 // break the streak right before it started
                } else {
                    let weekendDip = calendar.isDateInWeekend(day) ? 0.12 : 0
                    let roll = Double.random(in: 0..<1, using: &random)
                    if roll < spec.consistency - weekendDip {
                        count = spec.target
                    } else {
                        count = spec.target > 1 ? Int.random(in: 1..<spec.target, using: &random) : 0
                    }
                }
                if count > 0 {
                    habit.logs.append(HabitLog(day: day, count: count))
                }
            }
        }
        try? context.save()
    }

    /// Prefilled values for the "New Habit" form so the `add` screenshot is not empty.
    static var sampleNewHabitName: String { String(localized: "Evening walk") }
}

/// Small deterministic RNG so demo data (and therefore screenshots) are stable between runs.
struct SplitMix64: RandomNumberGenerator {
    private var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}
