# Display contract

## Purpose

Keep native DeepSeek Harness process information readable while separating the final answer after a successful turn. The reading view is a presentation of the public session projection, never a second Agent pipeline.

## Content fidelity

- Preserve literal reasoning text, whitespace, source order and block identity.
- Do not infer reasoning from wording, parse private provider logs, rewrite prompts or alter model settings.
- Preserve native context sources, tool types, summaries, filenames, details and results.
- Preserve the native conversation, input, model selector and approval system.
- Leave nontext and unknown content available through native renderers or a safe fallback.

## Lifecycle

During a turn, show its real process in chronological order. Starting body output, preparing tool input, finishing one tool, or entering another step is not whole-turn completion.

Only a successful public turn-close boundary folds process and intermediate commentary, leaving the final answer in place. Failures, interruptions, unknown terminal states and approval requests remain visible. A live text selection defers folding until the selection is released. A historical turn can always be reopened.

## Long reasoning

Settled thinking is always one row (duration, first-sentence preview, character count) that opens to the full text; when exactly one settled, non-failed operation (a tool call, or a command / manual-compaction record) follows it directly, that operation's row title joins the row as a quiet suffix and its row is shown under the full text once opened — running, failed or interrupted operations, live thinking, a following cluster, anything in between and a row the reader has already opened keep separate rows; with 折叠思考 on, live thinking is one row as well. Otherwise live thinking shows a neutral card that bounds the transcript without replacing it. The viewport mask is 26px. Follow is continuous, not stepped: one rAF loop writes the viewport's native scroll offset per frame, driven by a velocity-matched controller — an EMA of the measured tail growth feeds the speed forward and a proportional term closes residual lag. Under steady streaming the viewport moves at exactly the content speed with zero visible lag; a burst or a resume closes the gap smoothly at a capped speed. The position is clamped to the live tail every frame, so the viewport never passes the transcript end, rolls back, clones the transcript or loops old text; a shrinking tail re-aims instead of freezing. All metrics are cached from the resize signal, so neither the scroll nor the fade costs more as a single card grows long: the loop reads no layout, and native scrolling rasterizes against the viewport, not the transcript. When the stream stops or the loop settles, it parks itself until the next growth.

When the stream ends while following, the same controller glides the residual lag to the end and stops; user interaction during the glide cancels it at the painted position.

Expanding changes viewport size and preserves position and follow state. Wheel, touch, viewport focus or selection pause following. The explicit follow control resumes only when no text is selected. Completed history stays static. The full source text remains available.

## Text and status motion

Assign reveal times from source positions before rendering Markdown. Only newly appended text receives opacity/blur motion; existing paragraphs, page surfaces and text color do not animate. The animated frontier is bounded: text whose reveal has finished renders as plain text, and only the live reveal window (roughly duration plus queue delay worth of words) exists as components, so a long single paragraph costs the same per frame as a short one. Unicode graphemes and punctuation keep their source order. Media and custom blocks do not enter the text queue.

Busy labels and the active row use the native `TextShimmer`; the busy state dot is the native `StateDot`. The reader ships no shimmer of its own and no opacity pulse. Elapsed time and attention states do not shimmer. Timing and easing live in Motion tokens.

## Process panel

One turn's process is a plain status header row (chevron, state dot or native spinner, status text, then elapsed time and step / tool / failure counts as quiet secondary text) with the rows indented 22px below it; there is no panel container: no background, ring, shadow or radius, and error, interrupted and waiting show only through the dot and the status text colour. Rows use the native 24px row grammar and are listed in time order; step labels are not rendered, the step grouping only feeds the counts and the earlier-steps row. While a turn is not successfully closed (running, failed, interrupted, waiting on an action or unknown), earlier steps condense into one summary row and only the latest step is shown in full until the reader opens it. Consecutive operational items — tool calls and command / manual-compaction records — merge into one cluster row when there are two or more, after that condensing and over the visible rows, so a cluster may span step boundaries; reasoning, narration, mid-turn input, notices and other records break it. The cluster row carries the 0.1.18 summary as its title and the total elapsed time on the right; while a member runs it shows the native spinner and shimmer and names the running call, and a cluster with a failure is red and open by default, otherwise collapsed. A successful close collapses the panel to its header and leaves the answer in place; failures, interruptions, approvals and unresolved windows stay open. Mid-turn human input appears inside the panel at its chronological position.

Mid-turn narration in the panel uses the secondary label colour (the Markdown root's own primary colour is overridden; inline code stays primary); the answer zone is unchanged.

The answer zone holds the closing reply. A successful slash-command result renders there as Markdown, while its lifecycle row stays in the panel. Mid-turn steering and command inputs keep their rewind seat inside the panel; the seat exists only while the process panel is expanded, so in a collapsed finished turn it appears after the panel is expanded. A submitted plan is a record row with the plan title that unfolds to the plan Markdown; it carries no approval status.

The closing row of every closed turn, including failed and interrupted ones, shows delivered-file cards, copy, fork, and clock, duration and usage. Delivered files come from the turn's `deliverables` data and duration from the turn's start and end times; only the clock and token usage come from turn-tail. Copy takes the rendered answer text. Fork is offered at the turn's end sequence like the native action and is hidden when turn-tail reports `branchUnavailable`. Nothing is injected into the DOM to compute it.

A floating control appears only when the reader is scrolled away from the bottom: a status capsule while the turn runs, a round jump button otherwise. The reading position is remembered per session in memory only and is not persisted.

A view request from another surface (for example the native conversation) waits while the session is loading and is dropped if its target is still absent afterwards. Tool calls inside a collapsed panel are not auto-expanded to reach a target.

## Motion tokens

Structural motion uses cubic-bezier(.2,.8,.2,1): 100ms hover, 200ms state swaps and floating surfaces, 260ms expand and collapse, 350ms word reveal with 1px blur. The only busy signals are the native TextShimmer on the panel status and the active row, and the native StateDot spinner. Heavy mode only enables off-screen turn optimization; visible motion is never degraded by content size. Reduced motion, motion off, forced colors and background tabs settle to the received content. Not implemented in 0.2.0: the spec's 200ms fade-in with a 4px lift for live rows (spec 6.2 item 6); new rows appear immediately and only text keeps the word reveal.

## Reading and accessibility

Manual reading, selection and keyboard access take precedence over automatic following. A guard pause must stay visible and closable: while a selection or focus inside the reader holds the follow and the reader still claims the bottom, new content beyond the bottom budget surfaces the jump pill, and using the pill clears reader-owned selection and focus so following resumes. A pause with no affordance and no exit is a stall, not a guard. Reduced-motion preferences, disabled motion and background views settle to the received content. Errors stay local to their block. Do not turn user interaction into a permanent lock that prevents successful-turn folding.

## Extensions and safety

Trusted plugins may register `dsh-clearview.block`. Native content remains the fallback. This release does not execute arbitrary generated markup, embed an MCP App host or grant capabilities to generated UI.

## Streaming work budget

Chat, session and pending interactions are selected at their native subscription boundary. A text-only publication must not replace Reader structure or notify unchanged historical seats. Turn groups retain identity across unrelated appends, rewind visibility changes remain structural, and file-change summaries fetch current nodes again when the conversation becomes idle.

Keep one pending frame per streaming buffer and batch retirement of completed word wrappers. Their absolute birth times and opacity/blur keyframes remain unchanged. Size observers cache the outer follow target; history measurements finish before any intrinsic-size writes. Heavy-load handling may avoid off-screen work, but must not remove visible blur or shimmer.

DOM compatibility modules use the Reader's explicit snapshot reader rather than requiring a whole-chat React subscription or depending on fiber internals. Historical fallback detection remains for older roots.

The browser performance fixture runs against an explicitly selected host with a fresh Chrome profile and synthetic session data. It imports the host's actual React and primitive components, not tool-renderer mocks. Run from the development package with `DSH_TEST_URL` set to that host and optionally `CHROME_PATH`, then `node scripts/verify-reader-performance.mjs`. `--trace` records timeline and CPU evidence; `--baseline` plus `CLEARVIEW_PERF_SOURCE` selects a baseline source checkout. `CLEARVIEW_PERF_OUTPUT` controls the local evidence directory. No fixture sends an Agent request or edits host session data. Test Chrome is stopped after each run; temporary browser profiles may remain when cleanup is restricted by the environment.

Compare text commits and visible scroll progress as well as rAF intervals. Include the final frame after a sample window so a trailing long task is not censored. Profile the native desktop separately before claiming the desktop's frame-rate issue is resolved.

## Verification

Use unit coverage for projection, lifecycle, source-ordered streaming, graphemes, Markdown and two-line stepping. Verify live Host manifest, served bundle, native process details, literal reasoning, motion, successful folding, reopening, narrow layouts and reduced motion separately. Keep private session evidence outside this repository.
