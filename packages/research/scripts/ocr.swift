// Vitrin — reads the text in competitor screenshots with macOS Vision.
// Usage: ocr <lang1,lang2> <image>...   Output: one JSON line per image {"file":…, "lines":[…]}
import Foundation
import Vision
import AppKit

let args = CommandLine.arguments.dropFirst()
guard let langArg = args.first else {
    FileHandle.standardError.write("usage: ocr <languages> <image>...\n".data(using: .utf8)!)
    exit(64)
}
let languages = langArg.split(separator: ",").map(String.init)

for path in args.dropFirst() {
    var lines: [String] = []
    if let image = NSImage(contentsOfFile: path),
       let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = languages
        let handler = VNImageRequestHandler(cgImage: cg, options: [:])
        try? handler.perform([request])
        let observations = (request.results ?? [])
            // Top-to-bottom; Vision uses a bottom-left origin.
            .sorted { $0.boundingBox.minY > $1.boundingBox.minY }
        for obs in observations {
            // Keep large text only (headlines): height > 2.5% of the image.
            guard obs.boundingBox.height > 0.025, let top = obs.topCandidates(1).first else { continue }
            lines.append(top.string)
        }
    }
    let payload: [String: Any] = ["file": path, "lines": lines]
    if let data = try? JSONSerialization.data(withJSONObject: payload), let s = String(data: data, encoding: .utf8) {
        print(s)
    }
}
