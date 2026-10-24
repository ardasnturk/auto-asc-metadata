import SwiftData
import SwiftUI
import UserNotifications

/// "Reminders" tab: one daily reminder per habit.
struct RemindersView: View {
    @Environment(AppRouter.self) private var router
    @Query(sort: \Habit.sortOrder) private var habits: [Habit]
    @State private var status: UNAuthorizationStatus = .notDetermined

    var body: some View {
        let activeCount = habits.filter(\.reminderEnabled).count
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 14) {
                        HabitIconView(symbolName: "bell.badge.fill", color: Color("BrandStart"), size: 40)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Notifications").font(.headline)
                            Text(statusDescription).font(.subheadline).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                        if status == .notDetermined {
                            Button("Allow") {
                                Task {
                                    await ReminderScheduler.requestAuthorization()
                                    status = await ReminderScheduler.authorizationStatus()
                                }
                            }
                            .buttonStyle(.borderedProminent)
                        }
                    }
                    .padding(.vertical, 4)
                }

                Section {
                    ForEach(habits) { habit in
                        ReminderRow(habit: habit)
                    }
                } header: {
                    Text("Daily reminders · \(activeCount) active")
                } footer: {
                    Text("Reminders repeat every day at the time you choose.")
                }

                Section {
                    Button {
                        router.isShowingPaywall = true
                    } label: {
                        HStack(spacing: 14) {
                            HabitIconView(symbolName: "crown.fill", color: Color("BrandEnd"), size: 40)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Smart reminders").font(.headline).foregroundStyle(.primary)
                                Text("Only get nudged on days you haven't checked in. Included in Ritim Plus.")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(.tertiary)
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
            .navigationTitle("Reminders")
            .overlay {
                if habits.isEmpty {
                    ContentUnavailableView("No habits yet", systemImage: "bell.slash",
                                           description: Text("Add a habit to set up reminders."))
                }
            }
            .task { status = await ReminderScheduler.authorizationStatus() }
        }
    }

    private var statusDescription: LocalizedStringKey {
        switch status {
        case .authorized, .provisional, .ephemeral: "Allowed. Reminders arrive on time."
        case .denied: "Turned off. You can enable them in Settings."
        default: "Not set up yet."
        }
    }
}

struct ReminderRow: View {
    @Bindable var habit: Habit

    private var time: Binding<Date> {
        Binding {
            Calendar.current.date(bySettingHour: habit.reminderHour, minute: habit.reminderMinute, second: 0, of: .now) ?? .now
        } set: { newValue in
            let components = Calendar.current.dateComponents([.hour, .minute], from: newValue)
            habit.reminderHour = components.hour ?? 9
            habit.reminderMinute = components.minute ?? 0
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            HabitIconView(symbolName: habit.symbolName, color: habit.color, size: 34)
            VStack(alignment: .leading, spacing: 2) {
                Text(habit.name)
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)
                Text(habit.reminderEnabled ? "Every day" : "Off")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            if habit.reminderEnabled {
                DatePicker("Reminder time", selection: time, displayedComponents: .hourAndMinute)
                    .labelsHidden()
            }
            Toggle(isOn: $habit.reminderEnabled) {
                Text("Remind me about \(habit.name)")
            }
            .labelsHidden()
        }
        .onChange(of: habit.reminderEnabled) { reschedule() }
        .onChange(of: habit.reminderHour) { reschedule() }
        .onChange(of: habit.reminderMinute) { reschedule() }
    }

    private func reschedule() {
        Task { await ReminderScheduler.update(for: habit) }
    }
}
