# Display contract

## Purpose

Present a turn the way Claude Code Desktop does: one chronological transcript in which narration, grouped operations, thinking and the final answer all stay readable. The reading view is a presentation of the public session projection, never a second Agent pipeline.

## Content fidelity

- Preserve literal reasoning text, whitespace, source order and block identity.
- Do not infer reasoning from wording, parse private provider logs, rewrite prompts or alter model settings.
- Preserve native context sources, tool types, summaries, filenames, details and results.
- Preserve the native conversation, input, model selector and approval system.
- Leave nontext and unknown content available through native renderers or a safe fallback.

## Lifecycle

During a turn, show its real process in chronological order. Starting body output, preparing tool input, finishing one tool, or entering another step is not whole-turn completion. Nothing folds when a turn ends: the closing narration and the answer continue the same column. Failures, interruptions, unknown terminal states and approval requests are shown by the status line (below) and stay in place.

## Transcript entries and grouping

A turn is one column with no container, header, counts or "earlier steps" row. Narration between operations and the final answer share one serif `.prose` style. Entries:

- User message: a right-hand bubble, six lines then clamped behind 展开全文 / 收起 (outside the rewind seat). Mid-turn input and command input are smaller bubbles at their chronological position; the rewind seat is always present.
- Operation row: icon, Chinese verb and target ("运行 `npm run build`", "编辑 path +2 −1"), no durations. Opening it shows the detail block (output, arguments, search results, red/green diff for edits). A failure is marked red in the row only and never opens by itself.
- Settled thought: one row, 「思考了 N 秒」, opening to the full text in grey serif italic. No preview and no character count.
- Plan: when `todo_write` carries items, a checklist card updated in place; otherwise an ordinary operation row. `todo_write` and `dispatch` never join a group.
- Sub-agent (`dispatch`): its own 「子代理」 row, never merged into a group.
- Notices, retries, compaction and other records: quiet one-line rows; turn triggers open the turn with a grey line and 「展开原文」.

Grouping is pure derivation in `transcript-model.ts`. Consecutive operations (tool calls except `todo_write` / `dispatch`, plus command and manual-compaction records) merge into one line when there are two or more. The summary counts by kind, joined by "，" in order of first appearance: 运行了 N 条命令 / 读取了 N 个文件 / 写入了 N 个文件 / 编辑了 N 个文件 / 搜索了 N 次 / 访问了 N 次网页 / 使用了 N 个技能 / 调用了 N 次工具 / 执行了 N 个操作 (records). Failures add a red 「· N 次失败」. A group is open while any member runs and folds once settled, unless the reader opened or closed it. Thoughts, narration, user input, notices and other records break a group.

## Status line and live thinking

An open (or just stopped) turn ends with one status line: an orange ✻ (slowly rotating while running), a shimmering verb and `elapsed · 已思考 …`. Waiting on an action shows 「等待你的操作」; an interrupted or failed turn shows the line in red with the reason. Thinking being generated streams below the status line as grey serif italic text in a `role="region"` viewport (about six lines, faded at the top), driven by the same follow controller described below; when it settles it becomes the 「思考了 N 秒」 row. Reduced motion jumps to the tail instead of gliding. The only floating control is the round 回到最新 button, shown when the reader is scrolled away from the bottom.

Follow is continuous, not stepped: one rAF loop writes the viewport's native scroll offset per frame, driven by a velocity-matched controller. An EMA of the measured tail growth feeds the speed forward and a proportional term closes residual lag. Under steady streaming the viewport moves at exactly the content speed with zero visible lag; a burst or a resume closes the gap smoothly at a capped speed. The position is clamped to the live tail every frame, so the viewport never passes the transcript end, rolls back or loops old text; a shrinking tail re-aims instead of freezing. All metrics are cached from the resize signal, so the loop reads no layout; when the stream stops or the loop settles, it parks itself until the next growth. When the stream ends while following, the controller glides the residual lag to the end and stops; user interaction during the glide cancels it at the painted position.

Wheel, touch, viewport focus or selection pause following. The explicit follow control resumes only when no text is selected. The full source text remains available.

## Tokens

Reader colours are Claude's own, as HSL triples in `--cc-*` variables in `Reader.module.css`, with a light and a dark set keyed on the host's `body[data-ds-dark-theme]`. The reader root paints the page background (`bg-100`); the host sidebar, top bar and composer are untouched. The brand orange (`accent-brand`) is used only for the running ✻. Inside the reader, colours come from `--cc-*`; the host `--dsw-*` aliases are remapped on the reader root so embedded host primitives (native tool-result components) follow the same palette.

## Fonts

Three roles with Claude's fallbacks: serif for narration, answers and thinking (`anthropic-serif, Georgia, "Times New Roman", "PingFang SC", "Microsoft YaHei", serif`), sans for interface text such as bubbles, rows, status and footer (`anthropic-sans, ui-sans-serif, -apple-system, "Segoe UI", …`), mono for code (`anthropic-mono, ui-monospace, "Cascadia Mono", Consolas, monospace`). Font files are never shipped. The server (`src/server/claude-fonts.ts`) registers a read-only prefix route through the host `webServer` (skipped when the host has none, as in Electron and tests) that answers only `/dsh-clearview/fonts/{sans,serif,mono}.woff2`. It takes the newest `%LOCALAPPDATA%\AnthropicClaude\app-*` directory, reads the `@font-face` rules of the stylesheets under `resources/ion-dist/assets/v1`, and serves the matching normal-weight file as `font/woff2` with a long cache; anything missing is a 404 and the client falls back to the stack above. The client declares the `@font-face` rules pointing at this route.

## Text and status motion

Assign reveal times from source positions before rendering Markdown. Only newly appended text receives opacity/blur motion; existing paragraphs, page surfaces and text color do not animate. The animated frontier is bounded: text whose reveal has finished renders as plain text, and only the live reveal window (roughly duration plus queue delay worth of words) exists as components, so a long single paragraph costs the same per frame as a short one. Unicode graphemes and punctuation keep their source order. Media and custom blocks do not enter the text queue.

The status line verb shimmers and its ✻ rotates only while running; elapsed time and attention states do not shimmer. Group, detail and thought rows open and close with a height transition. Timing and easing live in Motion tokens.

## Turn footer and views

The closing row of every closed turn, including failed and interrupted ones, shows delivered-file cards, the session's file changes, copy, fork, and clock, duration and usage. Delivered files come from the turn's `deliverables` data and duration from the turn's start and end times; only the clock and token usage come from turn-tail. Copy takes the rendered answer text. Fork is offered at the turn's end sequence like the native action and is hidden when turn-tail reports `branchUnavailable`. Nothing is injected into the DOM to compute it. A successful slash-command result renders as Markdown in the answer. A submitted plan is a record row with the plan title that unfolds to the plan Markdown; it carries no approval status.

The reading position is remembered per session in memory only. A view request from another surface (for example the native conversation) waits while the session is loading and is dropped if its target is still absent afterwards.

## Compat contract

Kept: `data-dsh-clearview` (version), `section[data-reader-turn]`, `data-reader-turn-state`, `data-reader-turn-result`, `data-reader-key`, `data-reader-text[data-shown-length]`, `data-reader-anchor`, `data-reader-answer`, `data-dshcp-rewind-root` / `data-dshcp-rewind-seat`, `data-dshcp-heavy`, `data-dshcp-load`. Added for verification scripts: `data-reader-group` (`data-group-state` running / settled, `data-expanded`), `data-reader-status-line`, `data-reader-live-thought`, `data-reader-user-bubble` (`data-clamped`). Removed: `data-reader-panel`, `data-reader-earlier`, `data-reader-cluster`, `data-reader-narration`, `data-reader-activity-pill` and the panel header's disclosure; the anti-fold module `memory-tail-keep` is gone because nothing folds. `data-reader-process` / `data-reader-process-key` remain only as markers on the height-transition body and flow wrappers.

## Motion tokens

Structural motion uses cubic-bezier(.2,.8,.2,1): 100ms hover, 200ms state swaps and floating surfaces, 260ms expand and collapse, 350ms word reveal with 1px blur. The busy signals are the status line shimmer and ✻ rotation. Heavy mode only enables off-screen turn optimization; visible motion is never degraded by content size. Reduced motion, motion off, forced colors and background tabs settle to the received content. Not implemented in 0.2.0 or 0.3.0: the spec's 200ms fade-in with a 4px lift for live rows (spec 6.2 item 6); new rows appear immediately and only text keeps the word reveal.

## Reading and accessibility

Manual reading, selection and keyboard access take precedence over automatic following. A guard pause must stay visible and closable: while a selection or focus inside the reader holds the follow and the reader still claims the bottom, new content beyond the bottom budget surfaces the jump pill, and using the pill clears reader-owned selection and focus so following resumes. A pause with no affordance and no exit is a stall, not a guard. Reduced-motion preferences, disabled motion and background views settle to the received content. Errors stay local to their block.

## Extensions and safety

Trusted plugins may register `dsh-clearview.block`. Native content remains the fallback. This release does not execute arbitrary generated markup, embed an MCP App host or grant capabilities to generated UI.

## Streaming work budget

Chat, session and pending interactions are selected at their native subscription boundary. A text-only publication must not replace Reader structure or notify unchanged historical seats. Turn groups retain identity across unrelated appends, rewind visibility changes remain structural, and file-change summaries fetch current nodes again when the conversation becomes idle.

Keep one pending frame per streaming buffer and batch retirement of completed word wrappers. Their absolute birth times and opacity/blur keyframes remain unchanged. Size observers cache the outer follow target; history measurements finish before any intrinsic-size writes. Heavy-load handling may avoid off-screen work, but must not remove visible blur or shimmer.

DOM compatibility modules use the Reader's explicit snapshot reader rather than requiring a whole-chat React subscription or depending on fiber internals. Historical fallback detection remains for older roots.

The browser performance fixture runs against an explicitly selected host with a fresh Chrome profile and synthetic session data. It imports the host's actual React and primitive components, not tool-renderer mocks. Run from the development package with `DSH_TEST_URL` set to that host and optionally `CHROME_PATH`, then `node scripts/verify-reader-performance.mjs`. `--trace` records timeline and CPU evidence; `--baseline` plus `CLEARVIEW_PERF_SOURCE` selects a baseline source checkout. `CLEARVIEW_PERF_OUTPUT` controls the local evidence directory. No fixture sends an Agent request or edits host session data. Test Chrome is stopped after each run; temporary browser profiles may remain when cleanup is restricted by the environment.

Compare text commits and visible scroll progress as well as rAF intervals. Include the final frame after a sample window so a trailing long task is not censored. Profile the native desktop separately before claiming the desktop's frame-rate issue is resolved.

## Verification

Use unit coverage for projection, lifecycle, source-ordered streaming, graphemes, Markdown and two-line stepping. Verify live Host manifest, served bundle, native process details, literal reasoning, motion, group fold and reopen, narrow layouts and reduced motion separately. Keep private session evidence outside this repository.
