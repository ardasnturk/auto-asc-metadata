import SwiftUI

/// Circular progress indicator.
struct ProgressRing: View {
    var progress: Double
    var color: Color
    var lineWidth: CGFloat

    var body: some View {
        ZStack {
            Circle()
                .stroke(color.opacity(0.18), lineWidth: lineWidth)
            if progress > 0 {
                Circle()
                    .trim(from: 0, to: min(progress, 1))
                    .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
        }
        .animation(.spring(duration: 0.4), value: progress)
    }
}

/// Rounded, tinted square with the habit's SF Symbol.
struct HabitIconView: View {
    var symbolName: String
    var color: Color
    var size: CGFloat

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
            .fill(color.gradient)
            .frame(width: size, height: size)
            .overlay {
                Image(systemName: symbolName)
                    .font(.system(size: size * 0.46, weight: .semibold))
                    .foregroundStyle(.white)
            }
            .accessibilityHidden(true)
    }
}

/// Small metric tile used on the statistics and detail screens.
struct StatTile: View {
    var title: LocalizedStringKey
    var symbol: String
    var tint: Color
    var value: Text

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: symbol)
                .font(.headline)
                .foregroundStyle(tint)
            value
                .font(.title2.bold())
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color("CardBackground"), in: .rect(cornerRadius: 18, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// Titled container card.
struct Card<Content: View>: View {
    var title: LocalizedStringKey
    var subtitle: LocalizedStringKey?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline)
                if let subtitle {
                    Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
                }
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(Color("CardBackground"), in: .rect(cornerRadius: 22, style: .continuous))
    }
}

extension Double {
    var percentText: String { formatted(.percent.precision(.fractionLength(0))) }
}

extension Calendar {
    /// The last `count` days, oldest first, ending today.
    func lastDays(_ count: Int) -> [Date] {
        let today = startOfDay(for: .now)
        return (0..<count).reversed().compactMap { date(byAdding: .day, value: -$0, to: today) }
    }
}
