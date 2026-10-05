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

A neutral card bounds the transcript without replacing it. The viewport mask is 28px. Follow is continuous, not stepped: one rAF loop writes the viewport's native scroll offset per frame, driven by a velocity-matched controller — an EMA of the measured tail growth feeds the speed forward and a proportional term closes residual lag. Under steady streaming the viewport moves at exactly the content speed with zero visible lag; a burst or a resume closes the gap smoothly at a capped speed. The position is clamped to the live tail every frame, so the viewport never passes the transcript end, rolls back, clones the transcript or loops old text; a shrinking tail re-aims instead of freezing. All metrics are cached from the resize signal, so neither the scroll nor the fade costs more as a single card grows long: the loop reads no layout, and native scrolling rasterizes against the viewport, not the transcript. When the stream stops or the loop settles, it parks itself until the next growth.

When the stream ends while following, the same controller glides the residual lag to the end and stops; user interaction during the glide cancels it at the painted position.

Expanding changes viewport size and preserves position and follow state. Wheel, touch, viewport focus or selection pause following. The explicit follow control resumes only when no text is selected. Completed history stays static. The full source text remains available.

## Text and status motion

Assign reveal times from source positions before rendering Markdown. Only newly appended text receives opacity/blur motion; existing paragraphs, page surfaces and text color do not animate. The animated frontier is bounded: text whose reveal has finished renders as plain text, and only the live reveal window (roughly duration plus queue delay worth of words) exists as components, so a long single paragraph costs the same per frame as a short one. Unicode graphemes and punctuation keep their source order. Media and custom blocks do not enter the text queue.

Busy labels use a 2-second glyph-only shimmer and a short state swap. Initial, busy and elapsed labels all use the native font at 14px/24px, weight 400. The disclosure arrow sits 6px from the current label; no longest-state spacer. Elapsed time and attention states do not shimmer.

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
