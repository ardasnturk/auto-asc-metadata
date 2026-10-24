import SwiftUI

/// History of a single habit: streak tiles, calendar heatmap and recent days.
struct HabitDetailView: View {
    let habit: Habit
    @ScaledMetric(relativeTo: .largeTitle) private var iconSize: CGFloat = 72

    var body: some View {
        let streak = habit.currentStreak
        ScrollView {
            VStack(spacing: 16) {
                VStack(spacing: 10) {
                    HabitIconView(symbolName: habit.symbolName, color: habit.color, size: iconSize)
                    Text(habit.name)
                        .font(.title2.bold())
                        .multilineTextAlignment(.center)
                    Text(habit.targetPerDay > 1 ? "Goal: \(habit.targetPerDay) times a day" : "Goal: once a day")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 8)

                HStack(spacing: 12) {
                    StatTile(title: "Current streak", symbol: "flame.fill", tint: .orange,
                             value: Text("\(streak) days"))
                    StatTile(title: "Best streak", symbol: "trophy.fill", tint: .yellow,
                             value: Text("\(habit.bestStreak) days"))
                    StatTile(title: "Last 30 days", symbol: "chart.line.uptrend.xyaxis", tint: habit.color,
                             value: Text(habit.completionRate(days: 30).percentText))
                }

                Card(title: "Last 12 weeks", subtitle: "Every square is one day") {
                    HabitHeatmap(habit: habit, weeks: 12)
                        .frame(maxWidth: 560)
                        .frame(maxWidth: .infinity)
                }

                Card(title: "Recent days") {
                    RecentDaysList(habit: habit)
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 24)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(habit.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                ShareLink(item: String(localized: "I'm on a \(streak)-day streak for “\(habit.name)” with Ritim!")) {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
            }
        }
    }
}

/// GitHub-style heatmap: one column per week, one row per weekday.
struct HabitHeatmap: View {
    let habit: Habit
    let weeks: Int

    var body: some View {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: .now)
        let currentWeekStart = calendar.dateInterval(of: .weekOfYear, for: today)?.start ?? today
        let firstWeekStart = calendar.date(byAdding: .weekOfYear, value: -(weeks - 1), to: currentWeekStart) ?? today
        let columns: [[Date]] = (0..<weeks).map { week in
            (0..<7).compactMap { calendar.date(byAdding: .day, value: week * 7 + $0, to: firstWeekStart) }
        }
        let symbols = calendar.veryShortWeekdaySymbols
        let shift = calendar.firstWeekday - 1
        let orderedSymbols = Array(symbols[shift...] + symbols[..<shift])
        let pastDays = columns.joined().filter { $0 <= today && habit.exists(on: $0) }
        let completed = pastDays.filter { habit.isComplete(on: $0) }.count

        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 4) {
                VStack(spacing: 4) {
                    ForEach(Array(orderedSymbols.enumerated()), id: \.offset) { _, symbol in
                        Color.clear
                            .aspectRatio(1, contentMode: .fit)
                            .overlay {
                                Text(symbol)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                    }
                }
                .frame(maxWidth: .infinity)

                ForEach(columns, id: \.self) { week in
                    VStack(spacing: 4) {
                        ForEach(week, id: \.self) { day in
                            cell(for: day, today: today)
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .accessibilityElement()
            .accessibilityLabel(Text("Completed \(completed) of \(pastDays.count) days"))

            HStack(spacing: 4) {
                Spacer()
                Text("Less").font(.caption2).foregroundStyle(.secondary)
                ForEach([0.0, 0.35, 0.6, 0.8, 1.0], id: \.self) { level in
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(level == 0 ? Color.secondary.opacity(0.15) : habit.color.opacity(level))
                        .frame(width: 11, height: 11)
                }
                Text("More").font(.caption2).foregroundStyle(.secondary)
            }
            .accessibilityHidden(true)
        }
    }

    @ViewBuilder
    private func cell(for day: Date, today: Date) -> some View {
        let shape = RoundedRectangle(cornerRadius: 4, style: .continuous)
        Group {
            if day > today {
                shape.fill(Color.clear)
            } else if !habit.exists(on: day) {
                shape.fill(Color.secondary.opacity(0.07))
            } else {
                let progress = habit.progress(on: day)
                shape.fill(progress == 0 ? Color.secondary.opacity(0.15) : habit.color.opacity(0.3 + 0.7 * progress))
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .overlay {
            if day == today {
                shape.strokeBorder(Color.primary.opacity(0.6), lineWidth: 1.5)
            }
        }
    }
}

struct RecentDaysList: View {
    let habit: Habit

    var body: some View {
        let days = Array(Calendar.current.lastDays(7).reversed())
        VStack(spacing: 0) {
            ForEach(Array(days.enumerated()), id: \.element) { index, day in
                let count = habit.count(on: day)
                let done = habit.isComplete(on: day)
                HStack {
                    Text(day, format: .dateTime.weekday(.wide).day().month(.wide))
                    Spacer()
                    if habit.targetPerDay > 1 {
                        Text(verbatim: "\(count)/\(habit.targetPerDay)")
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                    Image(systemName: done ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(done ? habit.color : Color.secondary.opacity(0.5))
                        .font(.title3)
                        .accessibilityLabel(done ? Text("Completed") : Text("Not completed"))
                }
                .font(.subheadline)
                .padding(.vertical, 10)
                if index < days.count - 1 { Divider() }
            }
        }
    }
}
