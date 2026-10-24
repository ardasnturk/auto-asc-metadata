import SwiftUI

/// Colors a habit can use. Stored by raw value on `Habit.colorName`.
enum HabitColor: String, CaseIterable, Identifiable, Sendable {
    case blue, coral, purple, mint, orange, teal, indigo, pink

    var id: String { rawValue }

    var color: Color {
        switch self {
        case .blue: Color(red: 0.25, green: 0.55, blue: 0.98)
        case .coral: Color("BrandCoral")
        case .purple: Color(red: 0.63, green: 0.42, blue: 0.96)
        case .mint: Color("BrandMint")
        case .orange: Color(red: 1.00, green: 0.62, blue: 0.18)
        case .teal: Color(red: 0.11, green: 0.70, blue: 0.82)
        case .indigo: Color(red: 0.37, green: 0.39, blue: 0.93)
        case .pink: Color(red: 0.96, green: 0.36, blue: 0.62)
        }
    }

    var title: LocalizedStringResource {
        switch self {
        case .blue: "Blue"
        case .coral: "Coral"
        case .purple: "Purple"
        case .mint: "Mint"
        case .orange: "Orange"
        case .teal: "Teal"
        case .indigo: "Indigo"
        case .pink: "Pink"
        }
    }
}

/// SF Symbols offered in the "New Habit" icon picker, with spoken names for VoiceOver.
struct HabitSymbol: Identifiable, Sendable {
    let name: String
    let title: LocalizedStringResource
    var id: String { name }

    static let all: [HabitSymbol] = [
        HabitSymbol(name: "drop.fill", title: "Water"),
        HabitSymbol(name: "figure.run", title: "Running"),
        HabitSymbol(name: "book.fill", title: "Reading"),
        HabitSymbol(name: "leaf.fill", title: "Mindfulness"),
        HabitSymbol(name: "carrot.fill", title: "Nutrition"),
        HabitSymbol(name: "character.bubble.fill", title: "Language"),
        HabitSymbol(name: "moon.stars.fill", title: "Sleep"),
        HabitSymbol(name: "figure.walk", title: "Walking"),
        HabitSymbol(name: "dumbbell.fill", title: "Strength"),
        HabitSymbol(name: "bicycle", title: "Cycling"),
        HabitSymbol(name: "pills.fill", title: "Vitamins"),
        HabitSymbol(name: "heart.fill", title: "Health"),
        HabitSymbol(name: "music.note", title: "Music"),
        HabitSymbol(name: "pencil.and.outline", title: "Writing"),
        HabitSymbol(name: "sun.max.fill", title: "Morning"),
        HabitSymbol(name: "cup.and.saucer.fill", title: "Coffee"),
    ]
}
