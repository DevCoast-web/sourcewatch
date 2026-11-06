import SwiftUI
import SwiftData
import UniformTypeIdentifiers

struct NotesVault: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \ResearchNote.modifiedAt, order: .reverse) private var notes: [ResearchNote]
    @State private var search = ""
    @State private var selected: ResearchNote?
    var body: some View {
        List {
            ForEach(notes.filter { search.isEmpty || "\($0.title) \($0.body)".localizedCaseInsensitiveContains(search) }) { note in
                NavigationLink { NoteEditor(note: note) } label: {
                    VStack(alignment: .leading) { Text(note.title).font(.headline); Text(note.body).lineLimit(2).font(.caption).foregroundStyle(.secondary) }
                }
            }
            if notes.isEmpty { ContentUnavailableView("A place to connect ideas", systemImage: "note.text", description: Text("Create Markdown notes and reference other notes using [[titles]].")) }
        }.navigationTitle("Knowledge vault").searchable(text: $search, prompt: "Search notes")
            .toolbar { Button("New note", systemImage: "square.and.pencil") {
                let note = ResearchNote(); context.insert(note); selected = note
            } }
            .navigationDestination(item: $selected) { NoteEditor(note: $0) }
    }
}

struct NoteEditor: View {
    let note: ResearchNote
    @Environment(\.modelContext) private var context
    @Query private var notes: [ResearchNote]
    @State private var title = ""
    @State private var bodyText = ""
    @State private var message: String?
    @State private var share: SharedFile?
    @State private var showHistory = false
    @State private var revisions: [NoteRevision] = []
    private var outgoing: [ResearchNote] { notes.filter { $0.id != note.id && bodyText.localizedCaseInsensitiveContains("[[\($0.title)]]") } }
    private var backlinks: [ResearchNote] { notes.filter { $0.id != note.id && $0.body.localizedCaseInsensitiveContains("[[\(note.title)]]") } }
    var body: some View {
        Form {
            TextField("Note title", text: $title)
            Section("Markdown") { TextEditor(text: $bodyText).autocorrectionDisabled().textInputAutocapitalization(.never).frame(minHeight: 280).accessibilityLabel("Markdown note editor") }
            Section("Outgoing links") { ForEach(outgoing) { target in NavigationLink(target.title) { NoteEditor(note: target) } }; if outgoing.isEmpty { Text("Use [[Note title]] to link notes.").foregroundStyle(.secondary) } }
            Section("Backlinks") { ForEach(backlinks) { target in NavigationLink(target.title) { NoteEditor(note: target) } }; if backlinks.isEmpty { Text("No other notes reference this title.").foregroundStyle(.secondary) } }
            Section {
                Button("Export Markdown", systemImage: "square.and.arrow.up") {
                    do {
                        let url = FileManager.default.temporaryDirectory.appendingPathComponent("Note-\(UUID().uuidString).md")
                        try Data(("# \(title)\n\n\(bodyText)").utf8).write(to: url); share = SharedFile(url: url)
                    } catch { message = error.localizedDescription }
                }
                Button("Saved revisions", systemImage: "clock.arrow.circlepath") {
                    do {
                        let folder = try LocalLibrary().root.appendingPathComponent("notes/\(note.id)")
                        if FileManager.default.fileExists(atPath: folder.path) {
                            revisions = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil).map { try JSONDecoder().decode(NoteRevision.self, from: Data(contentsOf: $0)) }.sorted { $0.savedAt > $1.savedAt }
                        }
                        showHistory = true
                    } catch { message = error.localizedDescription }
                }
            }
            if let message { Text(message).font(.caption).textSelection(.enabled) }
        }.navigationTitle("Edit note").navigationBarTitleDisplayMode(.inline)
            .onAppear { title = note.title; bodyText = note.body }
            .toolbar { Button("Save") {
                do {
                    try LocalLibrary().saveNoteRevision(id: note.id, title: title, body: bodyText)
                    note.title = title; note.body = bodyText; note.modifiedAt = Date(); try context.save(); message = "Saved on this phone."
                } catch { message = error.localizedDescription }
            }.disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
            .sheet(item: $share) { ShareFile(url: $0.url) }
            .sheet(isPresented: $showHistory) {
                NavigationStack {
                    List(revisions.indices, id: \.self) { index in
                        let revision = revisions[index]
                        VStack(alignment: .leading) {
                            Text(revision.savedAt).font(.caption); Text(revision.title).font(.headline)
                            Text(revision.body).lineLimit(6)
                            Button("Restore to editor") { title = revision.title; bodyText = revision.body; showHistory = false }
                        }
                    }.navigationTitle("Saved note revisions").toolbar { Button("Done") { showHistory = false } }
                }
            }
    }
}

struct EvidenceTools: View {
    @State private var importing = false
    @State private var checking = false
    @State private var expected = ""
    @State private var result: String?
    var body: some View {
        Form {
            Section("Verify a mobile evidence ZIP") {
                Text("Verification runs entirely on this phone. It checks the stored files, receipt chain and ZIP checksums.")
                TextField("Retained manifest SHA-256 (optional)", text: $expected).textInputAutocapitalization(.never).autocorrectionDisabled()
                Button(checking ? "Verifying…" : "Choose evidence ZIP", systemImage: "checkmark.shield") { importing = true }.disabled(checking)
                if let result { Text(result).textSelection(.enabled).accessibilityIdentifier("verificationResult") }
            }
            Section("What this proves") { Text("A successful check shows internal consistency. Someone who replaces the entire bundle can create new hashes. Keep the manifest checksum separately. Hashes do not prove website authenticity, factual truth or independently certified publication times.") }
            Section("Local storage") { Text("Research lives in this app's on-device sandbox. No SourceWatch account, analytics, capture server or desktop connection is used. Export important evidence and notes to Files regularly. Deleting the app can delete its research. iOS device backups may include app data according to your device settings.") }
            Section("Preview scope") { Text("This native preview preserves imported files and pasted text, compares revisions, exports evidence and edits linked notes. It does not yet include automated website fetching, scheduled monitoring, Graph, Canvas or desktop database import. Imported HTML is never executed inside this app.") }
        }.navigationTitle("Evidence tools")
            .fileImporter(isPresented: $importing, allowedContentTypes: [.zip]) { selection in
                do {
                    let url = try selection.get(); let granted = url.startAccessingSecurityScopedResource(); defer { if granted { url.stopAccessingSecurityScopedResource() } }
                    guard let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= Evidence.maxBundle + 8 * 1024 * 1024 else { throw EvidenceError.invalid("ZIP exceeds size limit") }
                    let bytes = try Data(contentsOf: url)
                    let retained = expected.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                    guard retained.isEmpty || (retained.count == 64 && retained.allSatisfy { "0123456789abcdef".contains($0) }) else { throw EvidenceError.invalid("Enter a 64-character SHA-256") }
                    checking = true
                    Task {
                        do {
                            let count = try await Task.detached(priority: .userInitiated) { try Evidence.verify(EvidenceZIP.read(bytes), expectedManifestHash: retained.isEmpty ? nil : retained) }.value
                            result = "Integrity check passed: \(count) capture(s)."
                        } catch { result = "Verification failed: \(error.localizedDescription)" }
                        checking = false
                    }
                } catch { result = error.localizedDescription }
            }
    }
}
