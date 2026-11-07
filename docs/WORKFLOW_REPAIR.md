# Capture and workflow repair — beta.3

Real-use feedback exposed a capture failure and a confusing split between the research workspace and source monitor. The earlier passing test suite did not include a normal public HTTP-to-HTTPS redirect or establish that a new user could find the primary workflow. Earlier download release notes now identify that confirmed issue; they are not silently relabeled as fixed.

## Capture defect

Playwright treats an HTTP redirect chain as one intercepted request. Returning a 3xx response from a route handler does not cause the redirected request to return through that handler. SourceWatch's deny-all fallback proxy therefore rejected common redirects, yielding `ERR_TUNNEL_CONNECTION_FAILED`. See [Playwright's redirect documentation](https://playwright.dev/docs/network#redirects).

The repair follows up to ten redirects using the existing validated, DNS-pinned transport before the initial browser navigation. Each hop is subject to the public-network policy, request/byte budgets and cancellation. The browser loads the real final address with its validated response. Redirected subresources use the same transport. The fallback proxy still denies direct traffic; private/internal redirects are not allowed. URL fragments are preserved without fetching the same initial document twice. Both navigation and total deadlines remain enforced.

The previously failing public site was retried locally with the corrected engine: HTTP-to-HTTPS navigation completed with HTTP 200, readable text and a screenshot tile. That user's URL/results remain in ignored local audit logs; no real research record was fabricated or added to the public fixtures.

## Primary workflow

1. **Overview → Add a website:** enter a public URL, optionally name it and choose a collection.
2. **Sources & captures → Capture first version:** elapsed time and the running state stay visible. A successful first capture opens its preserved artifacts.
3. **Capture another version:** the comparison opens after the second capture. Added/deleted text and retained artifacts can be inspected independently.
4. **Export evidence ZIP:** download the source history and retain its manifest hash separately. Extract and use the desktop File-menu verifier or the included standalone command.

Sources, comparisons, notes, graph and Canvas now use the same persistent navigation. Source selection no longer dismisses one application-like overlay into another interface. Collection filtering, archived sources, search and capture activity remain available. Previously visited note/Canvas/intelligence editors stay mounted so navigation does not throw away their state. Additional legacy connections remain under Additional tools. Layout controls no longer dominate the start/capture screen.

The start page explains the workflow and surfaces failed sources with a route to review/retry. Capture failures provide an actionable summary and expandable original diagnostic. A separate preview workspace is explicitly labeled; it does not silently replace or migrate the user's original research.

## Validation and limits

The local consolidated suite completed **110 tests: 109 passed, zero failed, one Windows symlink-privilege skip**. Lint, typecheck and build passed. The two first-use/recovery browser tests exercise the visible UI, not API-created mockups: real Playwright rendering of changing fixture pages, actual source persistence, capture inspection, text comparison, browser ZIP download and independent verification of that downloaded bundle. Other regression checks cover draft/history retention, network denial, budgets, screenshots, exports and graph navigation.

These are engineering checks, not a claim that all websites or expanded modules work perfectly. Sites may refuse automation or require access the app does not bypass. Some JavaScript navigation patterns and redirected relative subresource references may not reproduce a normal browsing session; capture warnings/limits remain relevant. The iPhone preview is unchanged and does not gain automatic website capture, monitoring or desktop feature parity from this repair.

Local preview work uses a separate data directory with an explicit preview notice. Existing research is not automatically moved or deleted by the workflow repair.
