import Observation
import SwiftUI

enum AppTab: Hashable {
    case today, stats, reminders
}

/// Navigation state shared by the whole app. Can be primed from `-VitrinScreen`.
@MainActor
@Observable
final class AppRouter {
    var selectedTab: AppTab = .today
    var todayPath: [Habit] = []
    var isAddingHabit = false
    var isShowingPaywall = false
    private var opensDetailOnAppear = false

    init(initialScreen: VitrinScreen?) {
        switch initialScreen {
        case .home, .none: selectedTab = .today
        case .stats: selectedTab = .stats
        case .reminders: selectedTab = .reminders
        case .detail: opensDetailOnAppear = true
        case .add: isAddingHabit = true
        case .paywall: isShowingPaywall = true
        }
    }

    /// Pushes the most impressive habit when launched with `-VitrinScreen detail`.
    func openPendingDetail(from habits: [Habit]) {
        guard opensDetailOnAppear, let habit = habits.max(by: { $0.currentStreak < $1.currentStreak }) else { return }
        opensDetailOnAppear = false
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) { todayPath = [habit] }
    }
}
