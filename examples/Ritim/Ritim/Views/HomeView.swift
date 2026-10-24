import SwiftData
import SwiftUI

/// "Today" tab: overall progress plus a card per habit.
struct HomeView: View {
    @Environment(AppRouter.self) private var router
    @Environment(\.modelContext) private var context
    @Query(sort: \Habit.sortOrder) private var habits: [Habit]
    @State private var searchText = ""

    private var filteredHabits: [Habit] {
        let query = searchText.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return habits }
        return habits.filter { $0.name.localizedStandardContains(query) }
    }

    var body: some View {
        @Bindable var router = router
        NavigationStack(path: $router.todayPath) {
            ScrollView {
                VStack(spacing: 20) {
                    if searchText.isEmpty, !habits.isEmpty {
                        TodaySummaryCard(habits: habits)
                    }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: 14)], spacing: 14) {
                        ForEach(filteredHabits) { habit in
                            HabitCard(habit: habit)
                                .contextMenu {
                                    Button(role: .destructive) {
                                        ReminderScheduler.remove(for: habit)
                                        context.delete(habit)
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 24)
            }
            .background(Color(.systemGroupedBackground))
            .overlay {
                if habits.isEmpty {
                    ContentUnavailableView {
                        Label("No habits yet", systemImage: "sparkles")
                    } description: {
                        Text("Add your first habit and start building your rhythm.")
                    } actions: {
                        Button("New Habit") { router.isAddingHabit = true }
                            .buttonStyle(.borderedProminent)
                    }
                } else if filteredHabits.isEmpty {
                    ContentUnavailableView.search(text: searchText)
                }
            }
            .navigationTitle("Today")
            .searchable(text: $searchText, prompt: Text("Search habits"))
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        router.isShowingPaywall = true
                    } label: {
                        Label("Ritim Plus", systemImage: "crown.fill")
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        router.isAddingHabit = true
                    } label: {
                        Label("New Habit", systemImage: "plus")
                    }
                }
            }
            .navigationDestination(for: Habit.self) { habit in
                HabitDetailView(habit: habit)
            }
            .onAppear { router.openPendingDetail(from: habits) }
        }
    }
}

struct TodaySummaryCard: View {
    let habits: [Habit]
    @ScaledMetric(relativeTo: .title) private var ringSize: CGFloat = 92

    var body: some View {
        let today = Date.now
        let done = habits.filter { $0.isComplete(on: today) }.count
        let total = habits.count
        let progress = total == 0 ? 0 : Double(done) / Double(total)

        HStack(spacing: 18) {
            VStack(alignment: .leading, spacing: 8) {
                Text(today, format: .dateTime.weekday(.wide).day().month(.wide))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.85))
                Text("\(done) of \(total) habits done")
                    .font(.title2.bold())
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
                Text(message(for: progress))
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            ZStack {
                ProgressRing(progress: progress, color: .white, lineWidth: 10)
                Text(progress.percentText)
                    .font(.headline.bold())
                    .foregroundStyle(.white)
                    .monospacedDigit()
            }
            .frame(width: ringSize, height: ringSize)
        }
        .padding(20)
        .background(
            LinearGradient(colors: [Color("BrandStart"), Color("BrandEnd")], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: .rect(cornerRadius: 28, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }

    private func message(for progress: Double) -> LocalizedStringKey {
        switch progress {
        case 1...: "Perfect day! Every habit is done."
        case 0.5...: "Great rhythm, keep it going!"
        case 0.001...: "Nice start. One habit at a time."
        default: "A fresh day. Let's begin!"
        }
    }
}

struct HabitCard: View {
    let habit: Habit

    var body: some View {
        HStack(spacing: 14) {
            NavigationLink(value: habit) {
                HStack(spacing: 14) {
                    HabitIconView(symbolName: habit.symbolName, color: habit.color, size: 46)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(habit.name)
                            .font(.headline)
                            .foregroundStyle(.primary)
                            .multilineTextAlignment(.leading)
                        HStack(spacing: 4) {
                            Image(systemName: "flame.fill")
                                .foregroundStyle(.orange)
                                .accessibilityHidden(true)
                            Text("\(habit.currentStreak) days")
                                .foregroundStyle(.secondary)
                        }
                        .font(.subheadline)
                        WeekStrip(habit: habit)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)

            CheckInButton(habit: habit)
        }
        .padding(16)
        .background(Color("CardBackground"), in: .rect(cornerRadius: 22, style: .continuous))
    }
}

/// Ring that fills as the habit is checked in. Tapping adds one check-in.
struct CheckInButton: View {
    let habit: Habit
    @ScaledMetric(relativeTo: .body) private var size: CGFloat = 54

    var body: some View {
        let today = Date.now
        let count = habit.count(on: today)
        let done = habit.isComplete(on: today)

        Button {
            habit.registerCheckIn()
        } label: {
            ZStack {
                ProgressRing(progress: habit.progress(on: today), color: habit.color, lineWidth: 6)
                if done {
                    Image(systemName: "checkmark")
                        .font(.headline.weight(.heavy))
                        .foregroundStyle(habit.color)
                } else if habit.targetPerDay > 1 {
                    Text(verbatim: "\(count)/\(habit.targetPerDay)")
                        .font(.caption.bold())
                        .monospacedDigit()
                        .foregroundStyle(.primary)
                } else {
                    Image(systemName: "plus")
                        .font(.headline.weight(.bold))
                        .foregroundStyle(habit.color)
                }
            }
            .frame(width: size, height: size)
            .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.success, trigger: done) { _, new in new }
        .accessibilityLabel(Text("Check in \(habit.name)"))
        .accessibilityValue(done ? Text("Completed") : Text("\(count) of \(habit.targetPerDay)"))
        .accessibilityHint(Text("Adds one check-in for today"))
    }
}

/// Seven dots for the last seven days.
struct WeekStrip: View {
    let habit: Habit

    var body: some View {
        let days = Calendar.current.lastDays(7)
        let completed = days.filter { habit.isComplete(on: $0) }.count
        HStack(spacing: 5) {
            ForEach(days, id: \.self) { day in
                Circle()
                    .fill(habit.isComplete(on: day) ? habit.color : habit.color.opacity(0.16))
                    .frame(width: 9, height: 9)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text("Completed \(completed) of the last 7 days"))
    }
}
