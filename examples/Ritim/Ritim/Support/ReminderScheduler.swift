import Foundation
import UserNotifications

/// Schedules one repeating local notification per habit.
@MainActor
enum ReminderScheduler {
    private static func identifier(for habit: Habit) -> String { "habit-\(habit.id.uuidString)" }

    static func authorizationStatus() async -> UNAuthorizationStatus {
        if VitrinDemo.isActive { return .authorized }
        return await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    @discardableResult
    static func requestAuthorization() async -> Bool {
        if VitrinDemo.isActive { return true }
        let granted = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        return granted ?? false
    }

    static func update(for habit: Habit) async {
        guard !VitrinDemo.isActive else { return }
        let center = UNUserNotificationCenter.current()
        let id = identifier(for: habit)
        center.removePendingNotificationRequests(withIdentifiers: [id])
        guard habit.reminderEnabled, await requestAuthorization() else { return }

        let content = UNMutableNotificationContent()
        content.title = habit.name
        content.body = String(localized: "Time to keep your rhythm. Have you done it today?")
        content.sound = .default

        var components = DateComponents()
        components.hour = habit.reminderHour
        components.minute = habit.reminderMinute
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: true)
        try? await center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
    }

    static func remove(for habit: Habit) {
        guard !VitrinDemo.isActive else { return }
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [identifier(for: habit)])
    }
}
