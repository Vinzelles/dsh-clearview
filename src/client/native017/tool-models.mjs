// Vendored pure presentation models from @deepseek-ai/dsh-client-ui-tool 0.1.7-alpha.2 (MIT).
// Exact region hashes and upstream package identity: clearview-tool-model-provenance.json.
//#region ../../util/workspace-path/src/index.ts
		/** Whether a path uses a Windows drive or UNC prefix. */
		function isWindowsStylePath(value) {
			return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith("\\\\");
		}
		/**
		* Whether a path is absolute in either spelling the Host accepts: POSIX (`/a/b`) or Windows drive or UNC.
		* @param path - the path to classify.
		* @returns `true` for an absolute path; `false` for a Workspace-relative one.
		*/
		function isAbsoluteWorkspacePath(path) {
			return path.startsWith("/") || isWindowsStylePath(path);
		}
		/**
		* Resolve a Workspace-relative path into the Host-facing spelling used by path operations.
		* @param cwd - Session Workspace root, when known.
		* @param path - Absolute or Workspace-relative path.
		* @returns an absolute path when a Workspace root is available, otherwise the original path.
		*/
		function resolveWorkspacePath(cwd, path) {
			if (isAbsoluteWorkspacePath(path)) return path;
			if (cwd === void 0 || cwd === "") return path;
			const separator = isWindowsStylePath(cwd) && cwd.includes("\\") ? "\\" : "/";
			return `${cwd.replace(/[/\\]+$/, "")}${separator}${path.replace(/^[/\\]+/, "")}`;
		}
		/**
		* Abbreviate a POSIX home directory for display.
		* @param path - Absolute or already-short display path.
		* @param home - Host account home; absent skips abbreviation.
		* @returns `~` or `~/…` for the POSIX home and its descendants, otherwise `path`.
		*/
		function abbreviateHomePath(path, home) {
			if (home === void 0 || home === "") return path;
			if (isWindowsStylePath(path) || isWindowsStylePath(home)) return path;
			const root = home.replace(/\/+$/, "");
			if (root === "" || root === "/") return path;
			if (path.replace(/\/+$/, "") === root) return "~";
			if (path.startsWith(`${root}/`)) return `~${path.slice(root.length)}`;
			return path;
		}
		/**
		* Strip the workspace root from a workspace-rooted absolute path (display only).
		* @param text - the path to shorten.
		* @param cwd - session workspace root; absent or empty leaves the path unchanged.
		* @returns the path relative to the workspace root, or unchanged when it is not rooted there.
		*/
		function relativizeToCwd(text, cwd) {
			if (cwd === void 0 || cwd === "") return text;
			const root = cwd.replace(/[/\\]+$/, "");
			if (text.startsWith(`${root}/`) || text.startsWith(`${root}\\`)) return text.slice(root.length + 1);
			return text;
		}
		
//#region lib/types/client/tool/models/tool-call-model.js
		/** Locale key per generic row variant. */
		const VARIANT_TITLE_KEYS = {
			search: "tool.title.search",
			read: "tool.title.read",
			bash: "tool.title.bash",
			write: "tool.title.write",
			edit: "tool.title.edit",
			code: "tool.title.code",
			others: "tool.title.generic"
		};
		/**
		* Known tool name -> variant.
		*
		* `cordis_define` is deliberately absent: ui-cordis registers a keyed
		* `tool.call.toolview` entry for it, and a keyed hit REPLACES the generic row
		* (this table is only reached through GenericToolCard, the dispatch fallback in
		* ToolCallTree). An entry here would be unreachable, and a second title for the
		* same call would be a second answer to a question the card already owns.
		*/
		const TOOL_VARIANTS = {
			bash: "bash",
			pwsh: "bash",
			read: "read",
			read_image: "read",
			web_fetch: "read",
			web_search: "search",
			grep: "search",
			glob: "search",
			write: "write",
			edit: "edit",
			run_code: "code",
			cordis_package_inspect: "read",
			cordis_runtime_inspect: "read",
			cordis_run: "others",
			cordis_stop: "others",
			cordis_undefine: "others"
		};
		/** Tool-owned titles that refine a generic row variant without replacing it. */
		const TOOL_TITLE_KEYS = {
			cordis_package_inspect: "tool.title.inspect",
			cordis_runtime_inspect: "tool.title.inspect",
			cordis_run: "tool.title.runCordis",
			cordis_stop: "tool.title.stopCordis",
			cordis_undefine: "tool.title.removeCordis",
			pwsh: "tool.title.pwsh",
			read_image: "tool.title.readImage"
		};
		/**
		* Classify a tool name into its row variant.
		* @param toolName - wire tool name.
		* @returns matching variant, others when unknown.
		*/
		function classifyTool(toolName) {
			return TOOL_VARIANTS[toolName] ?? "others";
		}
		function deriveAutoReviewDenial(block) {
			if (!("kind" in block) || !block.isError) return null;
			const error = block.error;
			if (error?.name !== "AutoReviewDeniedError" || error.code !== "AUTO_REVIEW_DENIED") return null;
			return { reason: typeof error.reason === "string" ? error.reason : null };
		}
		/**
		* Flatten a settled result's content blocks to display text: text blocks
		* verbatim, other block shapes as pretty JSON. Empty content on a failed call
		* falls back to the structured error's `name: code` line.
		* @param node - the settled result node.
		* @returns the flattened result text (may be empty).
		*/
		function resultText(node) {
			const parts = [];
			for (const block of node.content) if (block.type === "text") parts.push(block.text);
			else parts.push(JSON.stringify(block, null, 2));
			if (parts.length === 0 && node.error !== void 0) parts.push(`${node.error.name}: ${node.error.code}`);
			return parts.join("\n");
		}
		function parseArgs(argsRaw) {
			try {
				return JSON.parse(argsRaw);
			} catch {
				return;
			}
		}
		function firstLine(text) {
			const nl = text.indexOf("\n");
			return nl === -1 ? text : text.slice(0, nl);
		}
		function pickString(args, keys) {
			for (const key of keys) {
				const v = args[key];
				if (typeof v === "string" && v !== "") return v;
			}
		}
		/** Summary key preference per variant (args-derived; result-derived summaries are a ledger item). */
		const SUMMARY_KEYS = {
			bash: ["description", "command"],
			read: [
				"path",
				"file_path",
				"url"
			],
			search: [
				"query",
				"pattern",
				"url"
			],
			write: ["path", "file_path"],
			edit: ["path", "file_path"],
			code: ["description"],
			others: []
		};
		function deriveSummary(variant, argsRaw) {
			const parsed = parseArgs(argsRaw);
			if (typeof parsed !== "object" || parsed === null) return firstLine(argsRaw);
			const args = parsed;
			if (variant === "search" && Array.isArray(args.queries)) {
				const queries = args.queries.filter((query) => typeof query === "string" && query !== "");
				if (queries.length > 0) return queries.map(firstLine).join(", ");
			}
			const picked = pickString(args, SUMMARY_KEYS[variant]);
			if (picked !== void 0) return firstLine(picked);
			for (const v of Object.values(args)) if (typeof v === "string" && v !== "") return firstLine(v);
			return firstLine(argsRaw);
		}
		/** Path keys only — never `url` (web_fetch lands on the read variant). */
		const FILE_PATH_KEYS = ["path", "file_path"];
		/** File-tool variants whose summary may be an openable workspace path. */
		const FILE_PATH_VARIANTS = new Set([
			"read",
			"write",
			"edit"
		]);
		function deriveFilePath(variant, argsRaw) {
			if (!FILE_PATH_VARIANTS.has(variant)) return void 0;
			const parsed = parseArgs(argsRaw);
			if (typeof parsed !== "object" || parsed === null) return void 0;
			const picked = pickString(parsed, FILE_PATH_KEYS);
			return picked === void 0 ? void 0 : firstLine(picked);
		}
		/**
		* Format one argument payload when its generic input body becomes visible.
		* @param variant - row presentation selected for the Tool name.
		* @param argsRaw - original argument JSON or incomplete raw text.
		* @returns display body, or null for empty input.
		*/
		function formatToolBody(variant, argsRaw) {
			if (argsRaw === "") return null;
			const parsed = parseArgs(argsRaw);
			if (parsed === void 0) return argsRaw;
			if (variant === "code" && typeof parsed === "object" && parsed !== null) {
				const code = parsed.code;
				if (typeof code === "string" && code !== "") return code;
			}
			return JSON.stringify(parsed, null, 2);
		}
		/**
		* Derive the full row model from a frozen call slice.
		* @param toolName - wire tool name (dispatch-supplied; survives windowless results).
		* @param block - RunningToolCall or ToolResultNode off the snapshot caches.
		* @param cwd - session workspace root; workspace-rooted path summaries display relative to it.
		* @param home - host account home; a leftover POSIX home path displays as `~`.
		* @returns the row model.
		*/
		function toolRowModel(toolName, block, cwd, home) {
			const variant = classifyTool(toolName);
			const done = "kind" in block;
			const argsRaw = (done ? block.call?.argsRaw : block.argsRaw) ?? "";
			const state = !done ? "running" : block.error?.code === "interrupted" ? "stopped" : block.isError ? "error" : "ok";
			const base = argsRaw === "" ? block.callId : abbreviateHomePath(relativizeToCwd(deriveSummary(variant, argsRaw), cwd), home);
			const toolTitleKey = TOOL_TITLE_KEYS[toolName];
			const summary = variant === "others" && toolName !== "" && toolTitleKey === void 0 ? `${toolName} · ${base}` : base;
			const output = done ? resultText(block) || null : null;
			const errorSummary = state === "error" && output !== null ? firstLine(output) : null;
			const bodyRaw = argsRaw === "" ? null : argsRaw;
			return {
				variant,
				titleKey: toolTitleKey ?? VARIANT_TITLE_KEYS[variant],
				summary,
				filePath: deriveFilePath(variant, argsRaw),
				bodyRaw,
				output,
				errorSummary,
				autoReviewDenial: deriveAutoReviewDenial(block),
				state
			};
		}
		
//#region lib/types/client/tool/models/raw-tool-call.js
		const parsedCalls = /* @__PURE__ */ new WeakMap();
		/**
		* Parse the call head paired with one immutable Tool block.
		* @param block - running or settled Tool block.
		* @returns the Tool name and object arguments, or null when the call head or valid JSON object is unavailable.
		*/
		function parsedToolCall(block) {
			const cached = parsedCalls.get(block);
			if (cached !== void 0 || parsedCalls.has(block)) return cached ?? null;
			const call = "kind" in block ? block.call : block;
			if (call === null) {
				parsedCalls.set(block, null);
				return null;
			}
			let value;
			try {
				value = JSON.parse(call.argsRaw);
			} catch {
				parsedCalls.set(block, null);
				return null;
			}
			if (typeof value !== "object" || value === null || Array.isArray(value)) {
				parsedCalls.set(block, null);
				return null;
			}
			const parsed = {
				name: call.name,
				args: value
			};
			parsedCalls.set(block, parsed);
			return parsed;
		}
		/**
		* Read the exact single text block consumed by first-party card derivations.
		* @param block - settled Tool result.
		* @returns its text, or undefined for any other content layout.
		*/
		function singleResultText(block) {
			if (block.content.length !== 1) return void 0;
			const only = block.content[0];
			return only?.type === "text" ? only.text : void 0;
		}
		/**
		* Validate the optional escalation pair shared by first-party shell and file
		* mutation tools.
		* @param args - parsed open-root Tool arguments.
		* @returns whether the declared escalation fields form a valid pair.
		*/
		function validEscalationFields(args) {
			const permission = args.sandbox_permissions;
			const justification = args.justification;
			if (permission === void 0 && justification === void 0) return true;
			if (permission !== "workspace-write" && permission !== "danger-full-access") return false;
			return typeof justification === "string" && justification.trim() !== "";
		}
		
//#region lib/types/client/tool/models/read-card-model.js
		/** Whether a model-supplied argument is a 1-based line position or count: an integer of at least 1. */
		function positiveInteger$1(value) {
			return typeof value === "number" && Number.isInteger(value) && value >= 1;
		}
		function validReadCall(block) {
			const call = parsedToolCall(block);
			if (call?.name !== "read") return false;
			const { file_path: path, offset, limit } = call.args;
			if (typeof path !== "string" || path.trim() === "") return false;
			if (offset !== void 0 && !positiveInteger$1(offset)) return false;
			if (limit !== void 0 && !positiveInteger$1(limit)) return false;
			return true;
		}
		function readMeta(meta) {
			if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return null;
			const { path, offset, lines, totalLines, lang } = meta;
			if (typeof path !== "string" || typeof offset !== "number" || !Number.isInteger(offset) || offset < 1) return null;
			if (typeof totalLines !== "number" || !Number.isInteger(totalLines) || totalLines < 0 || !Array.isArray(lines)) return null;
			if (lang !== void 0 && typeof lang !== "string") return null;
			const narrowed = [];
			let previous = offset - 1;
			for (const line of lines) {
				if (typeof line !== "object" || line === null || Array.isArray(line)) return null;
				const { number, text } = line;
				if (typeof number !== "number" || !Number.isInteger(number) || number < 1 || number <= previous) return null;
				if (number > totalLines || typeof text !== "string") return null;
				previous = number;
				narrowed.push({
					number,
					text
				});
			}
			return {
				path,
				offset,
				lines: narrowed,
				totalLines,
				...lang === void 0 ? {} : { lang }
			};
		}
		/**
		* The line one `read` call was about, from its arguments.
		*
		* `offset` is the read tool's own 1-based start line, so opening the path can
		* land where the model looked. Available while the call is still running,
		* unlike the persisted metadata, because the arguments carry it. The arguments
		* are model-produced JSON: only an integer of at least 1 is a line, and a call
		* whose `offset` is anything else names none.
		* @param block - running or settled Tool block.
		* @returns the 1-based line, or undefined when the call named none.
		*/
		function readCallLine(block) {
			if (!validReadCall(block)) return void 0;
			const { offset } = parsedToolCall(block)?.args ?? {};
			return positiveInteger$1(offset) ? offset : void 0;
		}
		/**
		* Derive a settled root read card after validating its persisted metadata and
		* model-facing read envelope.
		* @param block - running or settled Tool block.
		* @param sessionCwd - the session workspace root; a workspace-rooted absolute
		*   path label displays relative to it. Absent leaves the path as authored.
		* @param home - host account home; a leftover POSIX home path displays as `~`.
		* @returns the read-card props, or null for the generic path.
		*/
		function readCardModel(block, sessionCwd, home) {
			if (block.parentCallId !== void 0 || !("kind" in block) || block.isError) return null;
			if (!validReadCall(block)) return null;
			const meta = readMeta(block.meta);
			if (meta === null) return null;
			const text = singleResultText(block);
			if (text === void 0) return null;
			if (/^<path>[^\n]*<\/path>\n<type>file<\/type>\n<content>\n([\s\S]*)\n<\/content>$/u.exec(text)?.[1] === void 0) return null;
			return {
				label: abbreviateHomePath(relativizeToCwd(meta.path, sessionCwd), home),
				lines: meta.lines,
				totalLines: meta.totalLines,
				lang: meta.lang
			};
		}
		
//#region lib/types/client/tool/models/diff-card-model.js
		/**
		* Narrow opaque result metadata's `diffs` to well-formed hunks.
		* @param diffs - the metadata field to validate.
		* @returns the validated hunks, or null when the payload is not usable.
		*/
		function narrowDiffs(diffs) {
			if (!Array.isArray(diffs) || diffs.length === 0) return null;
			const out = [];
			for (const hunk of diffs) {
				if (typeof hunk !== "object" || hunk === null) return null;
				const { path, oldText, newText } = hunk;
				if (typeof path !== "string") return null;
				if (oldText !== null && typeof oldText !== "string") return null;
				if (typeof newText !== "string") return null;
				out.push({
					path,
					oldText,
					newText
				});
			}
			return out;
		}
		function intendedDiff(block) {
			const parsed = parsedToolCall(block);
			if (parsed === null) return null;
			if (parsed.name === "str_replace_editor") {
				const { command, path, file_text: fileText, old_str: oldText, new_str: newText } = parsed.args;
				if (typeof path !== "string" || path.trim() === "") return null;
				if (command === "create") {
					if (fileText !== void 0 && typeof fileText !== "string") return null;
					return {
						tool: "str_replace_editor",
						diff: {
							path,
							oldText: null,
							newText: fileText ?? ""
						}
					};
				}
				if (command === "str_replace") {
					if (oldText !== void 0 && typeof oldText !== "string") return null;
					if (newText !== void 0 && typeof newText !== "string") return null;
					return {
						tool: "str_replace_editor",
						diff: {
							path,
							oldText: oldText ?? null,
							newText: newText ?? ""
						}
					};
				}
				return null;
			}
			const { file_path: path } = parsed.args;
			if (typeof path !== "string" || path.trim() === "") return null;
			if (!validEscalationFields(parsed.args)) return null;
			if (parsed.name === "write") {
				const { content } = parsed.args;
				return typeof content === "string" ? {
					tool: "write",
					diff: {
						path,
						oldText: null,
						newText: content
					}
				} : null;
			}
			if (parsed.name !== "edit") return null;
			const { old_string: oldText, new_string: newText, replace_all: replaceAll } = parsed.args;
			if (typeof oldText !== "string" || typeof newText !== "string") return null;
			if (replaceAll !== void 0 && typeof replaceAll !== "boolean") return null;
			return {
				tool: "edit",
				diff: {
					path,
					oldText: oldText || null,
					newText
				}
			};
		}
		function appliedDiffs(meta) {
			if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return null;
			const diffs = meta.diffs;
			if (!Array.isArray(diffs)) return null;
			if (diffs.length === 0) return "empty";
			return narrowDiffs(diffs);
		}
		/**
		* Derive running diffs for root write/edit and `str_replace_editor`
		* create/replace calls, plus applied settled diffs for root write/edit calls.
		* A successful write with valid empty metadata uses its argument-derived
		* whole-file diff, matching create and identical-overwrite presentation;
		* `str_replace_editor` settles through Generic because it has no result view.
		* @param block - running or settled Tool block.
		* @returns the diff-card props, or null for the generic path.
		*/
		function diffCardModel(block) {
			if (block.parentCallId !== void 0) return null;
			const intended = intendedDiff(block);
			if (intended === null) return null;
			if (!("kind" in block)) return { card: { diffs: [intended.diff] } };
			if (intended.tool === "str_replace_editor") return null;
			if (block.isError) return null;
			const applied = appliedDiffs(block.meta);
			if (applied === null || applied === "empty") return intended.tool === "write" ? { card: { diffs: [intended.diff] } } : null;
			return { card: { diffs: applied } };
		}
		
//#region lib/types/client/tool/models/search-card-model.js
		function validSearchCall(block) {
			const call = parsedToolCall(block);
			if (call === null) return null;
			const { pattern, path } = call.args;
			if (typeof pattern !== "string") return null;
			if (call.name === "grep" && pattern === "") return null;
			if (call.name === "glob" && pattern.trim() === "") return null;
			if (call.name !== "grep" && call.name !== "glob") return null;
			if (path !== void 0 && (typeof path !== "string" || path.trim() === "")) return null;
			if (call.name === "grep") {
				const { include } = call.args;
				if (include !== void 0 && (typeof include !== "string" || !validInclude(include))) return null;
			}
			return call.name;
		}
		function validInclude(include) {
			if (include.trim() === "" || include.startsWith("!")) return false;
			let braceDepth = 0;
			for (const character of include) if (character === "{") braceDepth += 1;
			else if (character === "}") braceDepth = Math.max(0, braceDepth - 1);
			else if (character === "," && braceDepth === 0) return false;
			return true;
		}
		function searchFiles(value) {
			if (!Array.isArray(value)) return null;
			const files = [];
			for (const file of value) {
				if (typeof file !== "object" || file === null || Array.isArray(file)) return null;
				const { path, matches } = file;
				if (typeof path !== "string" || !Array.isArray(matches)) return null;
				const narrowed = [];
				for (const match of matches) {
					if (typeof match !== "object" || match === null || Array.isArray(match)) return null;
					const { lineNumber, line } = match;
					if (typeof lineNumber !== "number" || !Number.isInteger(lineNumber) || lineNumber < 1) return null;
					if (typeof line !== "string") return null;
					narrowed.push({
						lineNumber,
						line
					});
				}
				files.push({
					path,
					matches: narrowed
				});
			}
			return files;
		}
		function flattenContent(content) {
			const text = content.filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n");
			return text === "" ? void 0 : text;
		}
		/**
		* Derive a settled root grep/glob card from persisted metadata.
		* @param block - running or settled Tool block.
		* @returns search-card props, or null for the generic path.
		*/
		function searchCardModel(block) {
			if (block.parentCallId !== void 0 || !("kind" in block) || block.isError) return null;
			const tool = validSearchCall(block);
			if (tool === null) return null;
			if (typeof block.meta !== "object" || block.meta === null || Array.isArray(block.meta)) return null;
			const meta = block.meta;
			if (typeof meta.truncated !== "boolean") return null;
			if (typeof meta.total !== "number" || !Number.isInteger(meta.total) || meta.total < 0) return null;
			const common = {
				truncated: meta.truncated,
				total: meta.total
			};
			const recovery = meta.truncated ? flattenContent(block.content) : void 0;
			if (tool === "grep") {
				if (meta.shape !== "matches") return null;
				const files = searchFiles(meta.files);
				return files === null ? null : {
					recovery,
					card: {
						kind: "matches",
						files,
						...common
					}
				};
			}
			if (meta.shape !== "paths" || !Array.isArray(meta.paths)) return null;
			if (!meta.paths.every((path) => typeof path === "string")) return null;
			return {
				recovery,
				card: {
					kind: "paths",
					paths: [...meta.paths],
					...common
				}
			};
		}
		new TextEncoder();
		new TextDecoder();
		/**
		* Standardized, false-precision-safe wording for one {@link Omitted} value —
		* the "may standardize omission wording" half the library owns. `exact` prints
		* the count (`Omitted 3 items`); `unknown` prints NO count because the caller
		* did not provide one. `none` is the empty string.
		*
		* @param omitted The omission metadata from a retainer result.
		* @param unit The noun for the omitted quantity (`items`, `bytes`, `chars`, `lines`).
		* @returns A neutral clause (no trailing space), or `''` when nothing was omitted.
		*/
		function describeOmitted(omitted, unit) {
			switch (omitted.kind) {
				case "none": return "";
				case "exact": return `Omitted ${omitted.count} ${unit}.`;
				case "unknown": return `More ${unit} were omitted.`;
			}
		}
		
//#region lib/types/client/tool/models/terminal-card-model.js
		/**
		* Build the TerminalBlock display copy from the conversation locale seat —
		* the one place the primitive's label surface pairs with this package's
		* dictionary, shared by every terminal render site (chat row, bash row,
		* details panel).
		* @param t - the render site's conversation locale seat.
		* @returns the full label set for {@link TerminalBlockProps}'s `labels`.
		*/
		function terminalBlockLabels(t) {
			return {
				signal: (signal) => t("terminal.signal", { signal }),
				exitCode: (code) => t("terminal.exitCode", { code }),
				noExitCode: t("terminal.noExitCode"),
				running: t("terminal.running"),
				failed: t("terminal.failed"),
				done: t("terminal.done"),
				copy: t("copy"),
				copied: t("copied"),
				noOutput: t("terminal.noOutput"),
				collapseAria: t("terminal.collapseAria"),
				collapse: t("collapse"),
				expandAria: (hidden) => t("terminal.expandAria", { n: hidden }),
				expand: (hidden) => t("terminal.expandRest", { n: hidden })
			};
		}
		/**
		* Resolve locale-owned `terminal_send` copy while preserving Tool-authored
		* shell commands and descriptions verbatim.
		* @param model - locale-neutral terminal card data.
		* @param t - the render site's conversation locale seat.
		* @returns terminal props and description ready for rendering.
		*/
		function localizeTerminalCardModel(model, t) {
			if (model.copy.kind === "shell") return {
				card: {
					command: model.copy.command,
					...model.card
				},
				description: model.copy.description
			};
			return {
				card: {
					command: model.copy.text === "" ? t("terminal.sendInput") : model.copy.text,
					...model.card
				},
				description: t("terminal.session", { sessionId: model.copy.sessionId })
			};
		}
		/**
		* True when a settled terminal card reports a failing exit — a non-zero code
		* or a terminating signal. The bash tool settles a failing command as a
		* completed call (`isError` stays false: the exit status is result data), so
		* this is the collapsed row's only failure signal; without it the red exit
		* pill would be visible only after expanding the card.
		* @param model - a derived terminal card.
		* @returns whether the card's exit status is a failure.
		*/
		function terminalFailed(model) {
			const { exitCode, signal, running } = model.card;
			return running !== true && (exitCode !== void 0 && exitCode !== 0 || signal !== void 0);
		}
		/**
		* Resolve a shell call's workdir for display: an absolute path is used as-is,
		* a relative one joins under the session workspace, and an omitted one is the
		* session workspace. Without a session cwd, a relative path stays as authored
		* and an omitted one stays absent.
		* @param workdir - the raw call's workdir, if any.
		* @param sessionCwd - the session workspace root, if the caller knows it.
		* @returns the working directory for the prompt label, or undefined.
		*/
		function resolveTerminalCwd(workdir, sessionCwd) {
			if (workdir === void 0 || workdir === "") return sessionCwd;
			if (sessionCwd === void 0 || sessionCwd === "") return normalizeSegments(workdir);
			return normalizeSegments(resolveWorkspacePath(sessionCwd, workdir));
		}
		/**
		* Collapse `.` and `..` segments so the prompt label names the directory the
		* command actually ran in. The bash executor resolves the workdir before
		* running, so a joined `/w/app/..` must display as `w`, not as `..`. Separators
		* are preserved as authored (a Windows path keeps its backslashes) because this
		* value is only ever displayed; a `..` that would climb past the root is
		* dropped, which is what a filesystem does with it. A UNC path's `server` and
		* `share` are part of its root, not poppable segments: Windows cannot climb
		* above a share, so `\\\\server\\share` with a `..` stays there.
		* @param path - a joined or absolute path, possibly carrying `.`/`..` segments.
		* @returns the same path with those segments resolved.
		*/
		function normalizeSegments(path) {
			if (!/(?:^|[/\\])\.\.?(?:[/\\]|$)/.test(path)) return path;
			const unc = /^[/\\]{2}([^/\\]+)[/\\]+([^/\\]+)/.exec(path);
			if (unc !== null) {
				const [matched, server, share] = unc;
				const root = `\\\\${String(server)}\\${String(share)}`;
				const rest = collapse(path.slice(matched.length), true);
				return rest === "" ? root : `${root}\\${rest}`;
			}
			const separator = path.includes("\\") && !path.includes("/") ? "\\" : "/";
			const rooted = /^[/\\]/.test(path);
			const drive = /^[A-Za-z]:/.exec(path)?.[0] ?? "";
			const body = collapse(path.slice(drive.length), rooted || drive !== "", separator);
			const leading = rooted ? separator : "";
			return drive === "" ? `${leading}${body}` : `${drive}${rooted ? leading : separator}${body}`;
		}
		/**
		* Collapse the `.`/`..` segments of a path body against a known root state.
		* @param body - the path after any drive letter or UNC root.
		* @param rooted - the body hangs off a root, so a `..` at its top is dropped
		*   the way a filesystem drops one; without a root the `..` is kept, since it
		*   stays meaningful against a cwd this function cannot see.
		* @param separator - separator to rejoin with (default `/`).
		* @returns the collapsed body, without leading or trailing separators.
		*/
		function collapse(body, rooted, separator = "/") {
			const kept = [];
			for (const segment of body.split(/[/\\]/)) {
				if (segment === "" || segment === ".") continue;
				if (segment === "..") {
					if (kept.length > 0 && kept[kept.length - 1] !== "..") kept.pop();
					else if (!rooted) kept.push(segment);
					continue;
				}
				kept.push(segment);
			}
			return kept.join(separator);
		}
		function shellCall(name, args) {
			if (name !== "bash" && name !== "pwsh") return null;
			const { command, description, timeoutMs, workdir, run_in_background: background } = args;
			if (typeof command !== "string" || command.trim() === "") return null;
			if (timeoutMs !== void 0 && (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0)) return null;
			if (workdir !== void 0 && typeof workdir !== "string") return null;
			if (background !== void 0 && typeof background !== "boolean") return null;
			if (!validEscalationFields(args)) return null;
			if (description === void 0) return {
				kind: "shell",
				command,
				description: void 0,
				workdir: void 0,
				persistent: true,
				background: false
			};
			if (typeof description !== "string" || description.trim() === "") return null;
			return {
				kind: "shell",
				command,
				description,
				workdir,
				persistent: false,
				background: background === true
			};
		}
		/**
		* Identify a settled root call from the persistent Bash or PowerShell tool.
		* Its result stays on the generic input/output path because the persistent
		* shell can report resets and partial output without one process exit status.
		* @param block - running or settled Tool block.
		* @returns whether the block is a settled persistent-shell call.
		*/
		function isSettledPersistentShellCall(block) {
			if (!("kind" in block) || block.parentCallId !== void 0) return false;
			const parsed = parsedToolCall(block);
			if (parsed === null) return false;
			return shellCall(parsed.name, parsed.args)?.persistent === true;
		}
		/**
		* Identify a settled foreground shell preview whose spill footer can hide the exit marker.
		* @param block - running or settled Tool block.
		* @returns whether the shell output must remain generic without an inferred exit status.
		*/
		function isSpilledShellCall(block) {
			if (!("kind" in block)) return false;
			const parsed = parsedToolCall(block);
			if (parsed === null) return false;
			const call = shellCall(parsed.name, parsed.args);
			if (call === null || call.background) return false;
			const output = singleResultText(block);
			return output !== void 0 && hasSpillNotice(output);
		}
		function terminalSendCall(name, args) {
			if (name !== "terminal_send") return null;
			const { sessionId, text, submit, run_in_background: background } = args;
			if (typeof sessionId !== "string" || sessionId === "" || typeof text !== "string") return null;
			if (submit !== void 0 && typeof submit !== "boolean") return null;
			if (background !== void 0 && typeof background !== "boolean") return null;
			return {
				kind: "terminal-send",
				text,
				sessionId,
				background: background === true
			};
		}
		/**
		* Parse the marker literals owned by `@deepseek-ai/dsh-shell/render` without
		* importing that Host-only package into the Client dependency graph.
		* @param text - rendered shell result text.
		* @returns output with a trailing exit-code or signal marker extracted.
		*/
		function parseExitStatus(text) {
			const signal = /\n\[killed by signal: ([^\]\n]+)\]$/.exec(text);
			if (signal?.[1] !== void 0) return {
				output: text.slice(0, signal.index),
				signal: signal[1]
			};
			const exit = /\n\[exit code: (\d+)\]$/.exec(text);
			if (exit?.[1] !== void 0) return {
				output: text.slice(0, exit.index),
				exitCode: Number(exit[1])
			};
			return {
				output: text,
				exitCode: 0
			};
		}
		/**
		* Derive terminal props for supported shell and terminal-send calls, including
		* nested PTC dispatch calls. Standard shell results parse their final status
		* marker; persistent shell results, spill previews, background calls, errors,
		* and malformed input use the generic path. {@link isSettledPersistentShellCall} lets that generic
		* persistent result remain expandable without inventing one process status.
		* @param block - running or settled Tool block.
		* @param sessionCwd - session workspace root used to resolve workdir.
		* @returns locale-neutral terminal-card data, or null for the generic path.
		*/
		function terminalCardModel(block, sessionCwd) {
			const parsed = parsedToolCall(block);
			if (parsed === null) return null;
			const call = shellCall(parsed.name, parsed.args) ?? terminalSendCall(parsed.name, parsed.args);
			if (call === null || call.background) return null;
			const copy = call.kind === "shell" ? {
				kind: "shell",
				command: call.command,
				description: call.description
			} : {
				kind: "terminal-send",
				text: call.text,
				sessionId: call.sessionId
			};
			const cwd = resolveTerminalCwd(call.kind === "shell" ? call.workdir : void 0, sessionCwd);
			if (!("kind" in block)) return {
				copy,
				card: {
					cwd,
					output: void 0,
					exitCode: void 0,
					signal: void 0,
					running: true
				}
			};
			if (block.isError || call.kind === "shell" && call.persistent || isSpilledShellCall(block)) return null;
			const output = singleResultText(block);
			if (output === void 0) return null;
			const status = call.kind === "terminal-send" ? { output } : parseExitStatus(output);
			return {
				copy,
				card: {
					cwd,
					output: status.output,
					exitCode: status.exitCode,
					signal: status.signal,
					running: false
				}
			};
		}
		
//#region lib/types/client/tool/models/web-card-model.js
		function validWebCall(block) {
			const call = parsedToolCall(block);
			if (call === null) return null;
			if (call.name === "web_search") {
				const { queries } = call.args;
				if (!Array.isArray(queries) || queries.length === 0) return null;
				return queries.every((query) => typeof query === "string" && query.trim() !== "") ? call.name : null;
			}
			if (call.name === "web_fetch") {
				const { url } = call.args;
				return typeof url === "string" && url.trim() !== "" ? call.name : null;
			}
			return null;
		}
		function webSources(value) {
			if (!Array.isArray(value)) return null;
			const sources = [];
			for (const source of value) {
				if (typeof source !== "object" || source === null || Array.isArray(source)) return null;
				const { url, title, snippet, publishedAt } = source;
				if (typeof url !== "string") return null;
				if (title !== void 0 && typeof title !== "string") return null;
				if (snippet !== void 0 && typeof snippet !== "string") return null;
				if (publishedAt !== void 0 && typeof publishedAt !== "string") return null;
				sources.push({
					url,
					...title === void 0 ? {} : { title },
					...snippet === void 0 ? {} : { snippet },
					...publishedAt === void 0 ? {} : { publishedAt }
				});
			}
			return sources;
		}
		/**
		* Derive a settled root web-search or web-fetch card from persisted metadata.
		* @param block - running or settled Tool block.
		* @returns web-card props, or null for the generic path.
		*/
		function webCardModel(block) {
			if (block.parentCallId !== void 0 || !("kind" in block) || block.isError) return null;
			const tool = validWebCall(block);
			if (tool === null || typeof block.meta !== "object" || block.meta === null || Array.isArray(block.meta)) return null;
			const meta = block.meta;
			if (typeof meta.truncated !== "boolean") return null;
			if (tool === "web_search") {
				const sources = webSources(meta.sources);
				if (sources === null || meta.answer !== void 0 && typeof meta.answer !== "string") return null;
				return {
					kind: "search",
					answer: meta.answer,
					sources,
					truncated: meta.truncated
				};
			}
			if (typeof meta.url !== "string") return null;
			if (typeof meta.statusCode !== "number" || !Number.isInteger(meta.statusCode)) return null;
			return {
				kind: "fetch",
				url: meta.url,
				statusCode: meta.statusCode,
				truncated: meta.truncated
			};
		}
		
//#region ../../spill/spill-policy/src/notice.ts
		/** Browser-safe formatting and recognition of persisted spill-policy notices. */
		const OPEN = "(";
		const CLOSE = ")";
		const LOCATION = " Full formatted result stored at: ";
		const GUIDANCE_SEPARATOR = ". ";
		const SEPARATOR = "\n\n";
		const EXACT_OMISSION = describeOmitted({
			kind: "exact",
			count: 0
		}, "bytes");
		const COUNT_OFFSET = EXACT_OMISSION.indexOf("0");
		const COUNT_SUFFIX = EXACT_OMISSION.slice(COUNT_OFFSET + 1);
		function isOmission(text) {
			const imageNotice = / Omitted ([1-9][0-9]*) images\.$/.exec(text);
			if (imageNotice !== null) {
				if (!Number.isSafeInteger(Number(imageNotice[1]))) return false;
				text = text.slice(0, imageNotice.index);
			}
			if (text === describeOmitted({ kind: "none" }, "bytes") || text === describeOmitted({ kind: "unknown" }, "bytes")) return true;
			const count = Number(text.slice(COUNT_OFFSET, text.length - COUNT_SUFFIX.length));
			return Number.isSafeInteger(count) && count >= 0 && text === describeOmitted({
				kind: "exact",
				count
			}, "bytes");
		}
		/**
		* Recognize a final spill-policy notice in persisted text, including notice-only output.
		* This identifies the text convention, not authenticated tool-output origin.
		* @param text - complete recorded text result.
		* @returns whether a complete notice occupies the end of the result.
		*/
		function hasSpillNotice(text) {
			if (!text.endsWith(CLOSE)) return false;
			let start = 0;
			while (true) {
				const next = text.indexOf(`${SEPARATOR}${OPEN}`, start);
				const candidate = text.slice(start, next < 0 ? -1 : next);
				const location = candidate.indexOf(LOCATION, 1);
				if (candidate.startsWith(OPEN) && location >= 0 && isOmission(candidate.slice(1, location))) return text.indexOf(GUIDANCE_SEPARATOR, start + location + 34) >= 0;
				if (next < 0) return false;
				start = next + 2;
			}
		}
		
export { parsedToolCall, readCardModel, diffCardModel, searchCardModel, terminalCardModel, webCardModel };
