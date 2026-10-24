import SwiftData
import SwiftUI

/// Sheet for creating a new habit.
struct AddHabitView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    @Query private var habits: [Habit]

    @State private var name = VitrinDemo.isActive ? VitrinDemo.sampleNewHabitName : ""
    @State private var symbolName = VitrinDemo.isActive ? "figure.walk" : "drop.fill"
    @State private var color: HabitColor = VitrinDemo.isActive ? .teal : .blue
    @State private var target = 1
    @State private var remind = VitrinDemo.isActive
    @State private var reminderTime = Calendar.current.date(bySettingHour: 19, minute: 30, second: 0, of: .now) ?? .now

    @ScaledMetric(relativeTo: .body) private var swatchSize: CGFloat = 34
    @ScaledMetric(relativeTo: .body) private var iconCell: CGFloat = 44

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 14) {
                        HabitIconView(symbolName: symbolName, color: color.color, size: 52)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(trimmedName.isEmpty ? String(localized: "New Habit") : trimmedName)
                                .font(.headline)
                            Text(target > 1 ? "Goal: \(target) times a day" : "Goal: once a day")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                    .accessibilityElement(children: .combine)
                }

                Section("Name") {
                    TextField("e.g. Read 20 pages", text: $name)
                        .textInputAutocapitalization(.sentences)
                }

                Section("Icon") {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: iconCell), spacing: 10)], spacing: 10) {
                        ForEach(HabitSymbol.all) { symbol in
                            let selected = symbol.name == symbolName
                            Button {
                                symbolName = symbol.name
                            } label: {
                                Image(systemName: symbol.name)
                                    .font(.title3)
                                    .frame(width: iconCell, height: iconCell)
                                    .foregroundStyle(selected ? .white : color.color)
                                    .background(selected ? color.color : color.color.opacity(0.12),
                                                in: .rect(cornerRadius: 12, style: .continuous))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(Text(symbol.title))
                            .accessibilityAddTraits(selected ? .isSelected : [])
                        }
                    }
                    .padding(.vertical, 6)
                }

                Section("Color") {
                    HStack {
                        ForEach(HabitColor.allCases) { option in
                            Button {
                                color = option
                            } label: {
                                Circle()
                                    .fill(option.color)
                                    .frame(width: swatchSize, height: swatchSize)
                                    .overlay {
                                        if option == color {
                                            Image(systemName: "checkmark")
                                                .font(.caption.weight(.heavy))
                                                .foregroundStyle(.white)
                                        }
                                    }
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(Text(option.title))
                            .accessibilityAddTraits(option == color ? .isSelected : [])
                        }
                    }
                    .padding(.vertical, 4)
                }

                Section("Goal") {
                    Stepper(value: $target, in: 1...20) {
                        Text("\(target) times a day")
                    }
                }

                Section {
                    Toggle("Daily reminder", isOn: $remind.animation())
                    if remind {
                        DatePicker("Time", selection: $reminderTime, displayedComponents: .hourAndMinute)
                    }
                } header: {
                    Text("Reminder")
                }
            }
            .navigationTitle("New Habit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save)
                        .disabled(trimmedName.isEmpty)
                }
            }
        }
    }

    private func save() {
        let components = Calendar.current.dateComponents([.hour, .minute], from: reminderTime)
        let habit = Habit(
            name: trimmedName,
            symbolName: symbolName,
            colorName: color.rawValue,
            targetPerDay: target,
            sortOrder: (habits.map(\.sortOrder).max() ?? -1) + 1,
            reminderEnabled: remind,
            reminderHour: components.hour ?? 9,
            reminderMinute: components.minute ?? 0
        )
        context.insert(habit)
        Task { await ReminderScheduler.update(for: habit) }
        dismiss()
    }
}
