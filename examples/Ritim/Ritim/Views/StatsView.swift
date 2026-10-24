import Charts
import SwiftData
import SwiftUI

struct DayRate: Identifiable {
    let date: Date
    let rate: Double
    var id: Date { date }
}

/// "Statistics" tab: weekly completion, 30-day trend and current streaks.
struct StatsView: View {
    @Query(sort: \Habit.sortOrder) private var habits: [Habit]
    @State private var exportDocument: CSVDocument?
    @State private var isExporting = false

    private func rates(days: Int) -> [DayRate] {
        Calendar.current.lastDays(days).map { day in
            let eligible = habits.filter { $0.exists(on: day) }
            let done = eligible.filter { $0.isComplete(on: day) }.count
            return DayRate(date: day, rate: eligible.isEmpty ? 0 : Double(done) / Double(eligible.count))
        }
    }

    /// Smooths daily rates so the 30-day trend reads as a rhythm, not noise.
    private func rollingAverage(_ points: [DayRate], window: Int) -> [DayRate] {
        points.indices.map { index in
            let slice = points[max(0, index - window + 1)...index]
            return DayRate(date: points[index].date, rate: slice.map(\.rate).reduce(0, +) / Double(slice.count))
        }
    }

    var body: some View {
        let week = rates(days: 7)
        let month = rollingAverage(rates(days: 36), window: 7).suffix(30).map { $0 }
        let weeklyAverage = week.isEmpty ? 0 : week.map(\.rate).reduce(0, +) / Double(week.count)
        let bestStreak = habits.map(\.bestStreak).max() ?? 0
        let checkIns = habits.reduce(0) { $0 + $1.completedDays.count }

        NavigationStack {
            ScrollView {
                if habits.isEmpty {
                    ContentUnavailableView(
                        "No statistics yet",
                        systemImage: "chart.bar.xaxis",
                        description: Text("Check in a few habits and your charts will appear here.")
                    )
                    .padding(.top, 80)
                } else {
                    VStack(spacing: 16) {
                        HStack(spacing: 12) {
                            StatTile(title: "This week", symbol: "chart.pie.fill", tint: Color("BrandStart"),
                                     value: Text(weeklyAverage.percentText))
                            StatTile(title: "Best streak", symbol: "flame.fill", tint: .orange,
                                     value: Text("\(bestStreak) days"))
                            StatTile(title: "Check-ins", symbol: "checkmark.seal.fill", tint: Color("BrandMint"),
                                     value: Text(checkIns, format: .number))
                        }

                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 340), spacing: 16, alignment: .top)], spacing: 16) {
                            Card(title: "This week", subtitle: "Daily completion rate") {
                                WeeklyCompletionChart(points: week)
                            }
                            Card(title: "Last 30 days", subtitle: "7-day rolling average") {
                                TrendChart(points: month)
                            }
                            Card(title: "Current streaks", subtitle: "Days in a row") {
                                StreakChart(habits: habits)
                            }
                        }
                    }
                    .padding(.horizontal)
                    .padding(.bottom, 24)
                }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Statistics")
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    ShareLink(
                        item: String(localized: "This week I completed \(weeklyAverage.percentText) of my habits with Ritim. Best streak: \(bestStreak) days."),
                        subject: Text("My Ritim progress")
                    ) {
                        Label("Share progress", systemImage: "square.and.arrow.up")
                    }
                    Button {
                        exportDocument = CSVDocument(text: CSVExporter.csv(for: habits))
                        isExporting = true
                    } label: {
                        Label("Export CSV", systemImage: "tablecells")
                    }
                    .disabled(habits.isEmpty)
                }
            }
            .fileExporter(
                isPresented: $isExporting,
                document: exportDocument,
                contentType: .commaSeparatedText,
                defaultFilename: "ritim-export"
            ) { _ in }
        }
    }
}

struct WeeklyCompletionChart: View {
    let points: [DayRate]

    var body: some View {
        let today = Calendar.current.startOfDay(for: .now)
        Chart(points) { point in
            BarMark(
                x: .value("Day", point.date, unit: .day),
                y: .value("Completion", point.rate)
            )
            .foregroundStyle(
                LinearGradient(colors: [Color("BrandEnd"), Color("BrandStart")], startPoint: .bottom, endPoint: .top)
            )
            .opacity(point.date == today ? 0.55 : 1)
            .clipShape(.rect(cornerRadius: 6))
            .annotation(position: .top, spacing: 4) {
                Text(point.rate.percentText)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .chartYScale(domain: 0...1.12)
        .chartYAxis {
            AxisMarks(position: .leading, values: [0, 0.5, 1]) { value in
                AxisGridLine()
                AxisValueLabel {
                    if let rate = value.as(Double.self) { Text(rate.percentText) }
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: .stride(by: .day)) { _ in
                AxisValueLabel(format: .dateTime.weekday(.abbreviated), centered: true)
            }
        }
        .frame(height: 210)
    }
}

struct TrendChart: View {
    let points: [DayRate]

    var body: some View {
        Chart(points) { point in
            AreaMark(x: .value("Day", point.date, unit: .day), y: .value("Completion", point.rate))
                .interpolationMethod(.catmullRom)
                .foregroundStyle(
                    LinearGradient(colors: [Color("BrandStart").opacity(0.35), Color("BrandStart").opacity(0.02)],
                                   startPoint: .top, endPoint: .bottom)
                )
            LineMark(x: .value("Day", point.date, unit: .day), y: .value("Completion", point.rate))
                .interpolationMethod(.catmullRom)
                .lineStyle(StrokeStyle(lineWidth: 3, lineCap: .round))
                .foregroundStyle(Color("BrandStart"))
        }
        .chartYScale(domain: 0...1)
        .chartYAxis {
            AxisMarks(position: .leading, values: [0, 0.5, 1]) { value in
                AxisGridLine()
                AxisValueLabel {
                    if let rate = value.as(Double.self) { Text(rate.percentText) }
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: .stride(by: .day, count: 7)) { _ in
                AxisGridLine()
                AxisValueLabel(format: .dateTime.day().month(.abbreviated))
            }
        }
        .frame(height: 190)
    }
}

struct StreakChart: View {
    let habits: [Habit]

    var body: some View {
        let sorted = habits.map { (habit: $0, streak: $0.currentStreak) }.sorted { $0.streak > $1.streak }
        Chart(sorted, id: \.habit.id) { item in
            BarMark(
                x: .value("Days", item.streak),
                y: .value("Habit", item.habit.name)
            )
            .foregroundStyle(item.habit.color.gradient)
            .clipShape(.rect(cornerRadius: 5))
            .annotation(position: .trailing, spacing: 6) {
                Text(item.streak, format: .number)
                    .font(.caption.bold())
                    .foregroundStyle(item.habit.color)
            }
        }
        .chartXAxis(.hidden)
        .chartYAxis {
            AxisMarks { _ in
                AxisValueLabel()
            }
        }
        .frame(height: CGFloat(max(sorted.count, 1)) * 34)
    }
}
