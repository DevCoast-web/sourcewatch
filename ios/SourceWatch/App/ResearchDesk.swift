import SwiftUI
import SwiftData
import UniformTypeIdentifiers
import PDFKit

struct ResearchDesk: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \ResearchSource.createdAt, order: .reverse) private var sources: [ResearchSource]
    @Query(sort: \ResearchNote.modifiedAt, order: .reverse) private var notes: [ResearchNote]
    @State private var search = ""
    @State private var adding = false
    var body: some View {
        TabView {
            NavigationStack {
                List {
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("FOLLOW THE RECORD.").font(.caption).tracking(2).foregroundStyle(.secondary)
                            Text("Your research. On your phone.").font(.title2.bold())
                            Text("Preserve the source. Connect the context.").foregroundStyle(.secondary)
                            HStack { Label("\(sources.count) sources", systemImage: "tray.full"); Spacer(); Label("\(notes.count) notes", systemImage: "note.text") }.font(.caption)
                        }.padding(.vertical, 8)
                    }
                    Section("Research directory") {
                        ForEach(sources.filter { search.isEmpty || "\($0.title) \($0.url) \($0.collection)".localizedCaseInsensitiveContains(search) }) { source in
                            NavigationLink { SourceDetail(source: source) } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(source.title).font(.headline)
                                    Text(source.collection).font(.caption).foregroundStyle(.secondary)
                                    if !source.url.isEmpty { Text(source.url).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                                }.padding(.vertical, 4)
                            }
                        }
                        if sources.isEmpty { ContentUnavailableView("Keep your first receipt", systemImage: "doc.badge.plus", description: Text("Add a source, then preserve text or import a file saved from Safari.")) }
                    }
                    Section { Text("Native iPhone preview · offline by design. Imports are researcher-supplied evidence, not independently fetched website captures.").font(.caption).foregroundStyle(.secondary) }
                }
                .navigationTitle("SourceWatch")
                .searchable(text: $search, prompt: "Search sources and collections")
                .toolbar { Button("Add source", systemImage: "plus") { adding = true } }
                .sheet(isPresented: $adding) { AddSource() }
            }.tabItem { Label("Research", systemImage: "square.grid.2x2") }
            NavigationStack { NotesVault() }.tabItem { Label("Notes", systemImage: "note.text") }
            NavigationStack { EvidenceTools() }.tabItem { Label("Evidence", systemImage: "checkmark.shield") }
        }
    }
}

struct AddSource: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var url = ""
    @State private var collection = "Unsorted"
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                TextField("Source title", text: $title)
                TextField("Original URL (optional)", text: $url).textInputAutocapitalization(.never).keyboardType(.URL).autocorrectionDisabled()
                TextField("Collection", text: $collection)
                Text("A URL is a reference only. This version does not fetch it or contact a server.").font(.caption)
                if let error { Text(error).foregroundStyle(.red) }
            }.navigationTitle("New source")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) { Button("Add") {
                        let source = ResearchSource(title: title.trimmingCharacters(in: .whitespacesAndNewlines), url: url, collection: collection)
                        context.insert(source)
                        do { try context.save(); dismiss() } catch { context.delete(source); self.error = error.localizedDescription }
                    }.disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || title.count > 120 || url.count > 2048 || collection.count > 80) }
                }
        }
    }
}

struct SourceDetail: View {
    let source: ResearchSource
    @State private var receipts: [Receipt] = []
    @State private var error: String?
    @State private var adding = false
    @State private var share: SharedFile?
    @State private var exporting = false
    var body: some View {
        List {
            Section {
                Text(source.collection).font(.caption).foregroundStyle(.secondary)
                Text(source.url).textSelection(.enabled)
                Button("Preserve a revision", systemImage: "doc.badge.plus") { adding = true }
            }
            Section("Revision history · \(receipts.count)") {
                ForEach(Array(receipts.enumerated()).reversed(), id: \.element.id) { index, receipt in
                    NavigationLink {
                        ReceiptDetail(receipt: receipt, previous: index > 0 ? receipts[index - 1] : nil)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(receipt.title).font(.headline)
                            Text(receipt.observedAt).font(.caption).foregroundStyle(.secondary)
                            Label(receipt.method == "user-supplied-text" ? "Pasted text" : "Imported file", systemImage: "hand.point.up.left").font(.caption2)
                        }
                    }
                }
                if receipts.isEmpty { Text("Nothing preserved yet. In Safari, save a PDF or copy the text you want to keep, then import it here.").foregroundStyle(.secondary) }
            }
            if let error { Section { Text(error).foregroundStyle(.red).textSelection(.enabled) } }
        }
        .navigationTitle(source.title).navigationBarTitleDisplayMode(.inline)
        .toolbar { Button("Export", systemImage: "square.and.arrow.up") { export() }.disabled(receipts.isEmpty || exporting) }
        .task { reload() }
        .sheet(isPresented: $adding, onDismiss: reload) { CaptureRevision(source: source) }
        .sheet(item: $share) { ShareFile(url: $0.url) }
    }
    private func reload() { do { receipts = try LocalLibrary().history(source.id); error = nil } catch { self.error = error.localizedDescription } }
    private func export() {
        exporting = true
        let id = source.id
        Task {
            do {
                let result = try await Task.detached(priority: .userInitiated) { try LocalLibrary().export(id) }.value
                let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let url = folder.appendingPathComponent("SourceWatch-\(id.prefix(8)).zip")
                try result.0.write(to: url)
                error = "Manifest SHA-256: \(result.1)\nRetain this separately to detect manifest replacement."
                share = SharedFile(url: url)
            } catch { self.error = error.localizedDescription }
            exporting = false
        }
    }
}

struct CaptureRevision: View {
    let source: ResearchSource
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var text = ""
    @State private var attachment: Data?
    @State private var ext: String?
    @State private var filename: String?
    @State private var importing = false
    @State private var saving = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                Section("Revision") { TextField("Revision title", text: $title) }
                Section("Readable text") {
                    TextEditor(text: $text).autocorrectionDisabled().textInputAutocapitalization(.never).frame(minHeight: 200).accessibilityLabel("Revision text")
                    Text("Paste the page text here. For imported PDFs, selectable text is extracted on-device. HTML is preserved as a file; paste its readable text separately.").font(.caption).foregroundStyle(.secondary)
                }
                Section("Original file · optional") {
                    Button("Import PDF, text, HTML or image", systemImage: "paperclip") { importing = true }
                    if let filename { Text(filename); Button("Remove attachment", role: .destructive) { attachment = nil; ext = nil; self.filename = nil } }
                }
                Section { Text("The recorded time is your phone's local observation time. The original website, publication time, response status and headers have not been independently verified.").font(.caption) }
                if let error { Text(error).foregroundStyle(.red) }
            }.navigationTitle("Preserve revision")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) }
                    ToolbarItem(placement: .confirmationAction) { Button(saving ? "Saving…" : "Preserve") { save() }.disabled(saving || title.isEmpty || (text.isEmpty && attachment == nil)) }
                }
                .onAppear { title = source.title }
                .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf, .plainText, .html, .png, .jpeg, UTType(filenameExtension: "md") ?? .plainText]) { result in
                    do {
                        let url = try result.get(); let granted = url.startAccessingSecurityScopedResource(); defer { if granted { url.stopAccessingSecurityScopedResource() } }
                        guard let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= Evidence.maxFile else { throw EvidenceError.invalid("File exceeds 32 MiB") }
                        let bytes = try Data(contentsOf: url), suffix = url.pathExtension.lowercased()
                        guard bytes.count <= Evidence.maxFile else { throw EvidenceError.invalid("File exceeds 32 MiB") }
                        var extracted: String?
                        if ["txt", "md"].contains(suffix) { extracted = String(data: bytes, encoding: .utf8) }
                        if suffix == "pdf" { extracted = PDFDocument(data: bytes)?.string }
                        if let extracted {
                            guard extracted.utf8.count <= 512 * 1024 else { throw EvidenceError.invalid("Extracted text exceeds 512 KiB. Import a smaller document.") }
                            text = extracted
                        }
                        attachment = bytes; ext = suffix; filename = url.lastPathComponent; error = nil
                    } catch { self.error = error.localizedDescription }
                }
        }
    }
    private func save() {
        saving = true
        let id = source.id, reference = source.url, heading = title, content = text, bytes = attachment, suffix = ext
        Task {
            do {
                _ = try await Task.detached(priority: .userInitiated) {
                    try LocalLibrary().capture(sourceID: id, title: heading, url: reference, text: content, attachment: bytes, extension: suffix)
                }.value
                dismiss()
            } catch { self.error = error.localizedDescription }
            saving = false
        }
    }
}

struct ReceiptDetail: View {
    let receipt: Receipt
    let previous: Receipt?
    @State private var text = ""
    @State private var lines: [DiffLine] = []
    @State private var error: String?
    @State private var compare = true
    @State private var share: SharedFile?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Label("Preserved on this device", systemImage: "checkmark.shield").font(.headline)
                Text(receipt.observedAt).font(.caption).foregroundStyle(.secondary)
                if !receipt.originalURL.isEmpty { Text(receipt.originalURL).font(.caption).textSelection(.enabled) }
                if previous != nil { Toggle("Compare with previous revision", isOn: $compare) }
                if compare && previous != nil {
                    Text("+ added · − removed").font(.caption).foregroundStyle(.secondary)
                    ForEach(lines) { line in
                        HStack(alignment: .top) {
                            Text(line.kind == .added ? "+" : line.kind == .removed ? "−" : " ").monospaced()
                            Text(line.text.isEmpty ? " " : line.text).strikethrough(line.kind == .removed).textSelection(.enabled)
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
                            .background(line.kind == .added ? Color.green.opacity(0.12) : line.kind == .removed ? Color.red.opacity(0.12) : Color.clear)
                    }
                } else { Text(text.isEmpty ? "No readable text supplied. Use the original attachment below." : text).textSelection(.enabled) }
                ForEach(receipt.files.keys.filter { $0 != "text.txt" }.sorted(), id: \.self) { name in
                    Button("Open / share \(name)", systemImage: "doc") {
                        do {
                            let bytes = try LocalLibrary().artifact(receipt, name)
                            let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
                            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                            let url = folder.appendingPathComponent(name); try bytes.write(to: url); share = SharedFile(url: url)
                        } catch { self.error = error.localizedDescription }
                    }
                }
                Text("Capture ID: \(receipt.id)").font(.caption2).textSelection(.enabled)
                if let error { Text(error).foregroundStyle(.red) }
            }.padding()
        }.navigationTitle(receipt.title).navigationBarTitleDisplayMode(.inline)
            .task {
                do {
                    let library = try LocalLibrary()
                    text = String(decoding: try library.artifact(receipt, "text.txt"), as: UTF8.self)
                    if let previous {
                        let old = String(decoding: try library.artifact(previous, "text.txt"), as: UTF8.self)
                        // Bound diff work independently of the larger preserved text limit.
                        if old.utf8.count + text.utf8.count <= 128 * 1024 && old.components(separatedBy: "\n").count + text.components(separatedBy: "\n").count <= 4000 {
                            let current = text
                            lines = await Task.detached { TextComparison.compare(old, current) }.value
                        } else { compare = false; error = "Inline comparison is limited to 128 KiB / 4,000 combined lines. Both complete originals remain preserved." }
                    }
                } catch { self.error = error.localizedDescription }
            }
            .sheet(item: $share) { ShareFile(url: $0.url) }
    }
}

struct SharedFile: Identifiable { let id = UUID(); let url: URL }
struct ShareFile: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: [url], applicationActivities: nil) }
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
