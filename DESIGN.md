# Display contract

## Purpose

Present a modern, coherent transcript in which narration, grouped operations, thinking and the final answer stay readable. From 0.3.2, matching Claude Desktop exactly is no longer the goal. The reading view is a presentation of the public session projection, never a second Agent pipeline. The current visual contract is [unified reading](docs/superpowers/specs/2026-10-10-clearview-032-unified-reading.md).

## Content fidelity

The `ask_user_question` receipt is a historical reading component, not an answer form. It pairs each input question with output `answers` by exact question ID, preserves selected labels and custom text, and uses primary text color for the user's decision. It stays outside operation groups and remains visible when the whole process folds. Context/options and the original tool input/result are separate local disclosures; inspection retains the actual call ID. Empty answers, missing IDs, invalid payloads and unsuccessful calls must not be presented as an inferred decision.

The receipt uses a compact header with its status and history/inspection links, without a separate footer. Question headers appear inline, selected answers wrap side by side, and custom text follows without an extra heading row. Context/options live inside the original-record disclosure. Keep the host body size and complete text; density comes from spacing and auxiliary chrome, not smaller type or truncation.

- Preserve literal reasoning text, whitespace, source order and block identity.
- Do not infer reasoning from wording, parse private provider logs, rewrite prompts or alter model settings.
- Preserve native context sources, tool types, summaries, filenames, details and results.
- Preserve the native conversation, input, model selector and approval system.
- Leave nontext and unknown content available through native renderers or a safe fallback.

## Lifecycle

During a turn, show its real process in chronological order. Starting body output, preparing tool input, finishing one tool, or entering another step is not whole-turn completion. From 0.3.1, completed turns fold process entries behind a single status summary while retaining final answers, user inputs and terminal notices. Interrupted or failed turns start expanded. An active selection or process focus delays automatic folding; an explicit current close action wins. Stored choices are scoped by session and turn. Stable outer entry seats animate grid height and opacity without unmounting their original content, including singleton-to-group promotion. Operation groups keep their own local disclosure rules below.

The reader root is transparent. Prose uses the host `--dsh-content-font-size` (fallback 14px plus host delta), primary text color and paragraph spacing; it does not add a font-size increase. Completed plan marks are fixed-size SVGs centered in border-box squares, independent of font metrics.

## Transcript entries and grouping

Markdown tables own one frame on the scroll wrapper, scoped to the reader so the host theme cannot introduce another owner. The inner table has no border, shadow or margin and uses table display. Only internal rows draw separators; the final row, including a header-only table, omits its bottom border. Keep table spacing, header colors, consistent cell padding and the existing bounded horizontal scrolling.

Thoughts, operation summaries, tools and records share one Line style: 32px minimum height, 5px/8px padding, 13px plus host delta, the host UI font, weight 400, one shared 16px icon/chevron slot and no resting border or fill. A collapsed row shows its operation icon; hover or keyboard focus replaces it with the arrow. Expanded rows keep the downward arrow. Both glyphs occupy the same grid cell, so the label never moves during a swap. Static rows show only their icon. Hover, focus and open states share subtle surfaces. Disclosures have no trailing action text; accessible expanded state remains exposed, and long summaries wrap. Expanded details share an inset, rail, 10px radius, border and surface. Prose uses primary color, host body size and paragraph spacing. From 0.3.9, thoughts belong to the surrounding process group; their original text is not fused into a tool label. The completed-turn summary remains a distinct, visible folding control with a bottom border only, transparent background and no corner radius.

The completed-turn summary also uses a shared 16px leading slot: its status dot is visible when collapsed and idle, replaced by a chevron on hover or keyboard focus. The expanded summary keeps the downward chevron. Both glyphs retain the status color, including danger states; label and metadata positions stay fixed during the 100ms swap. Motion-off and reduced-motion disable the transition. The existing whole-row button, accessible label, expanded state and process controls remain intact.

A turn is one column without an outer container or an "earlier steps" row. Completed turns have the summary described above. Narration and the final answer share one `.prose` style using the current native conversation font. Entries:

- User message: a right-hand bubble, six lines then clamped behind 展开全文 / 收起 (inside the bordered bubble; excluded from copied message text). Mid-turn input and command input are smaller bubbles at their chronological position; the rewind seat is always present.
- Operation row: icon, Chinese verb and target ("运行 `npm run build`", "编辑 path +2 −1"), no durations. Opening it shows the detail block (output, arguments, search results, red/green diff for edits). A failure is marked red in the row only and never opens by itself.
- Thought: a member of the continuous process group. Opening the group exposes its 「思考了 N 秒」 disclosure and full original text in a 128px scroll viewport. A thought-only group uses the same process header and stable group key when tools arrive. Historical thoughts remain at the reader's position; an opened current-step thought can follow while that step is active. No preview and no character count.
- Plan: the first successful, parseable, nonempty `todo_write` creates a checklist card updated in place. Later successful updates replace its items, including an explicit empty list that clears it. Pending, failed or interrupted updates preserve the last successful checklist and remain inspectable in the original-call history. Before a card is established, malformed or empty calls remain ordinary operation rows; promotion preserves their open details, focus and selection. `todo_write` and `dispatch` never join a group.
- Sub-agent (`dispatch`): its own 「子代理」 row, never merged into a group.
- Retry and failure notices: independent bordered warning/error surfaces, with wrapping summary and expandable details. Closed-turn retries are historical records, never ongoing work. Failed command/compaction records break operation groups. Other records keep quiet one-line rows; turn triggers use the shared process line, left chevron and detail surface; the timestamp stays secondary and the original text remains collapsible.

Grouping is pure derivation in `transcript-model.ts`. Consecutive reasoning and operations (tool calls except `todo_write` / `dispatch` / `ask_user_question`, plus command and manual-compaction records) share a process group. The summary includes 思考 and counts operations by kind, joined by "，" in order of first appearance. A lone tool stays a normal tool row; a lone thought has a process group, preserving the group's key and member parent when tools arrive. Failures add a red 「· N 次失败」. A group is open while a member runs or a thought retains its reading grace, selection, focus or manual reading intent. The reader's explicit close still wins and releases the retained seats. Narration, user input, questions, notices and other records remain group boundaries in source order. Tool-result media stays visible beside its call and does not split or hide inside the group.

## Status line and live thinking

An open turn has one status line: inside its live thinking group above the viewport, or at the flow tail when it is not streaming thinking. The small activity ring, shimmering verb and secondary `elapsed · 已思考 …` timing remain. Waiting shows 「等待你的操作」; interrupted or failed turns have an independent red terminal line. The one-second clock lives in a memoized status component so it never changes historical group renderer references. Thinking streams as secondary host UI text in a `role="region"` viewport capped at 128px, faded at the top, using the follow controller below. It settles into an in-group 「思考了 N 秒」 disclosure unless the reader is reviewing it. Reduced motion jumps to the tail instead of gliding. The round 回到最新 button appears when the reader leaves the bottom.

Follow is continuous, not stepped: one rAF loop writes the viewport's native scroll offset per frame, driven by a velocity-matched controller. An EMA of the measured tail growth feeds the speed forward and a proportional term closes residual lag. Under steady streaming the viewport moves at exactly the content speed with zero visible lag; a burst or a resume closes the gap smoothly at a capped speed. The position is clamped to the live tail every frame, so the viewport never passes the transcript end, rolls back or loops old text; a shrinking tail re-aims instead of freezing. All metrics are cached from the resize signal, so the loop reads no layout; when the stream stops or the loop settles, it parks itself until the next growth. When the stream ends while following, the controller glides the residual lag to the end and stops; user interaction during the glide cancels it at the painted position.

Wheel, touch, viewport focus or selection pause following. The explicit follow control resumes only when no text is selected. The page's 回到最新 control also resumes internal thought following, without clearing a valid selection. Wheel/touch reading also pins the original viewport across tool arrival, the next thinking step and turn completion, even without a selection or keyboard focus. 「结束回看」 releases a retained former-live viewport; ordinary historical thoughts do not show a follow button when they cannot follow. A focused or selected thought keeps its existing DOM seat until focus or selection is released. The full source text remains available. Unmount cancels every animation frame; switching to reduced motion cancels any residual glide before jumping to the tail.

Visual acceptance compares actual DSH renders against the unified row, prose and detail contracts above. The user superseded the earlier Claude-reference requirement. Horizontal overflow checks must also validate the viewport position of the reading column and prose: equal scroll/client widths can still hide left-clipped text.

## Tokens

The inherited --cc-* palette remains for embedded-component compatibility. Shared --cv-* tokens define row height, radius, process size, detail surfaces, hover/open fills and indentation for both themes. The root remains transparent; the host sidebar, top bar and composer are untouched. The palette's provenance is not a claim of visual equivalence to another app.

## Fonts

Prose inherits `--dsh-claude-font-prose`, falling back to the host `--dsw-font-family`. Process/UI text inherits `--dsw-font-family`; code inherits `--dsh-claude-font-code`, falling back to `--ds-font-family-code`. This preserves the actual native conversation's font choices and CJK fallback order. The reader never overrides these host font properties with its own aliases, which would create cycles. Body size remains the host size. Font files are not shipped. Existing read-only /dsh-clearview/fonts/{sans,serif,mono}.woff2 routes remain compatible with older consumers.

The compatibility `@font-face` rules remain declared with the module stylesheet; the current view selects the inherited host fonts. Opening the view does not append a font stylesheet or replace font rules during its first layout. Code cards draw exactly one outer frame; native banner and content corners share the inner radius, without clipping away the sticky language banner.

## Text and status motion

Assign reveal times from source positions before rendering Markdown. Only newly appended text receives opacity/blur motion; existing paragraphs, page surfaces and text color do not animate. The animated frontier is bounded: text whose reveal has finished renders as plain text, and only the live reveal window (roughly duration plus queue delay worth of words) exists as components, so a long single paragraph costs the same per frame as a short one. Unicode graphemes and punctuation keep their source order. Media and custom blocks do not enter the text queue.

The status line verb shimmers and its activity ring rotates only while running; elapsed time and attention states do not shimmer. Group, detail and thought rows open and close with a height transition. Timing and easing live in Motion tokens.

## Turn footer and views

The closing row of every closed turn, including failed and interrupted ones, shows delivered-file cards, the session's file changes, copy, fork, and clock, duration and usage. Delivered files come from the turn's `deliverables` data and duration from the turn's start and end times; only the clock and token usage come from turn-tail. Copy takes the rendered answer text. Fork is offered at the turn's end sequence like the native action and is hidden when turn-tail reports `branchUnavailable`. Nothing is injected into the DOM to compute it. A successful slash-command result renders as Markdown in the answer. A submitted plan is a record row with the plan title that unfolds to the plan Markdown; it carries no approval status.

The reading position is remembered per session in memory only. A view request from another surface (for example the native conversation) waits while the session is loading and is dropped if its target is still absent afterwards.

## Compat contract

Kept: `data-dsh-clearview` (version), `section[data-reader-turn]`, `data-reader-turn-state`, `data-reader-turn-result`, `data-reader-key`, `data-reader-text[data-shown-length]`, `data-reader-anchor`, `data-reader-answer`, `data-dshcp-rewind-root` / `data-dshcp-rewind-seat`, `data-dshcp-heavy`, `data-dshcp-load`. Verification markers include `data-reader-group`, `data-reader-status-line`, `data-reader-live-thought`, `data-reader-user-bubble` and, from 0.3.1, `data-reader-turn-disclosure`, `data-reader-process-entry`, `data-folded` and `data-process-open`. The old panel/earlier/cluster/activity-pill markers remain removed. Selection pinning reads actual process-entry seats, not the whole flow, so selecting the retained final answer does not expand its process. The old `memory-tail-keep` DOM patch stays removed: the renderer directly protects the final answer while folding process entries.

## Motion tokens

Structural motion uses cubic-bezier(.2,.8,.2,1): 100ms hover, 200ms state swaps and floating surfaces, 260ms expand and collapse, 350ms response-word reveal with 1px blur. Reasoning starts at 80% opacity, has no stagger queue, and resolves in 180ms with the same 1px blur so tail-follow never exposes invisible text. The busy signals are status-text shimmer and activity-ring rotation. Heavy mode only enables off-screen turn optimization; visible motion is never degraded by content size. Reduced motion, motion off, forced colors and background tabs settle to the received content. Not implemented in 0.2.0 or 0.3.0: the spec's 200ms fade-in with a 4px lift for live rows (spec 6.2 item 6); new rows appear immediately and only text keeps the word reveal.

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

### 0.3.6 reading interactions

The status and statistics in a turn summary share one font size and line height, including narrow layouts. The user-message anchor wraps the visual bubble and a separate message action row. Keep the copy action after the visual bubble so the rewind plugin cannot choose the full-text icon as its portal target. Full-text disclosure uses an accessible icon inside the bubble without adding a line of its own.

Streaming and settled thinking share one transcript seat and viewport. A thought displayed live stays open for 2400ms after completion, then uses the existing 260ms size/opacity fold. Hover, focus, manual scrolling and selection pause that timer. Explicit closing remains available; manual reopening stays open. Reduced motion preserves the reading delay and skips the fold animation. Historical mounts remain collapsed; completed-turn folding waits for the thought exit to finish.

Use unit coverage for projection, lifecycle, source-ordered streaming, graphemes, Markdown and two-line stepping. Verify live Host manifest, served bundle, native process details, literal reasoning, motion, group fold and reopen, narrow layouts and reduced motion separately. Keep private session evidence outside this repository.

## 2026-10-10 readability follow-up (unreleased)

Process labels and targets use `--cv-process-text` (#73736f light / #999990 dark). Prose remains primary; expanded reasoning, warning/error semantics and diff colours are not dimmed. The Anthropic Sans file available on this machine has no CJK glyphs. Explicit CJK families precede generic/system fallback; body size and weight remain unchanged. Verify glyph selection with CDP platform-font evidence, not just the CSS stack.

The session file summary is a bordered local card with a file icon, title and optional counts. Show three paths initially, then an explicit remaining-file control. The review action reveals captured tool edit fragments, in operation order. Counts sum replaced/inserted fragment line ranges after common prefix/suffix removal; they are not a minimal line diff or working-tree net total. Missing diffs stay unknown. No rollback action is exposed without a supported session-wide transaction. Counts are memoized while toggling the card.

The reader's overflow-anchor compatibility rule only matches a conversation scroller containing its mounted root. Native composer visibility and hidden-until-found behaviour belong to companion plugins; do not mask their errors with reader-owned force-display rules. See the native compatibility diagnostic for the isolated fixes and deployment boundary.

## Streaming marker ownership

Blocks publish `data-reader-streaming`, never the host's generic `data-streaming`. The companion dsh-claude-style reveal engine claims the generic marker and paints CSS Highlight ranges starting at20% alpha. Those paint overrides are invisible to an element-opacity check and can overlap the reader's own reveal clock. Keep the existing word-motion profiles and128px follow viewport; do not solve a marker collision by shortening or removing their effects. Browser regression includes a real Highlight range, a dimmed positive control, and an unaffected reader node.
