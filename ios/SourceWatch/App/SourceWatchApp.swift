import SwiftUI
import SwiftData

@main struct SourceWatchApp: App {
    var body: some Scene {
        WindowGroup { ResearchDesk().tint(Color(red: 0.15, green: 0.40, blue: 0.32)) }
            .modelContainer(for: [ResearchSource.self, ResearchNote.self])
    }
}
