import SwiftUI
import UniformTypeIdentifiers

/// Plain-text CSV wrapper used with `.fileExporter`.
struct CSVDocument: FileDocument {
    static let readableContentTypes: [UTType] = [.commaSeparatedText]

    var text: String

    init(text: String) { self.text = text }

    init(configuration: ReadConfiguration) throws {
        text = String(decoding: configuration.file.regularFileContents ?? Data(), as: UTF8.self)
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(text.utf8))
    }
}

enum CSVExporter {
    /// One row per habit per logged day: `habit,date,count,target,completed`.
    @MainActor
    static func csv(for habits: [Habit]) -> String {
        let dateStyle = Date.ISO8601FormatStyle(timeZone: .current).year().month().day()
        var rows = ["habit,date,count,target,completed"]
        for habit in habits {
            for log in habit.logs.sorted(by: { $0.day < $1.day }) {
                rows.append([
                    escape(habit.name),
                    log.day.formatted(dateStyle),
                    String(log.count),
                    String(habit.targetPerDay),
                    log.count >= habit.targetPerDay ? "1" : "0",
                ].joined(separator: ","))
            }
        }
        return rows.joined(separator: "\n") + "\n"
    }

    private static func escape(_ value: String) -> String {
        guard value.contains(where: { $0 == "," || $0 == "\"" || $0 == "\n" }) else { return value }
        return "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }
}
