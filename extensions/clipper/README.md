# Local clipper companion

In a Chromium browser, open its Extensions page, enable developer mode, and load this directory as an unpacked extension. The extension asks only for the active tab and scripting access after you invoke it. No background monitoring, service account, remote endpoint, or arbitrary extension code is installed by SourceWatch.

Select text on a page and invoke the extension. Save the JSON locally, then import it through Workspace → Tools & exports → Web clipping import. Without a selection it copies article/body text. Production URL validation still rejects private/internal sources on import. Review clipped contents before saving. A clip is explicitly unarchived researcher input; add the public URL to Sources and capture it separately to preserve evidence.

The companion files are implemented but installation and browser-extension permission flow require manual validation. It does not claim direct-to-service clipping, full vault migration, or a preserved snapshot simply because a bookmark or clip exists.
