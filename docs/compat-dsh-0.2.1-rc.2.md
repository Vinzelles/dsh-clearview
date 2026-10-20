# dsh-clearview × DeepSeek Harness 0.2.1-rc.2 兼容性分析

- 分析对象：本仓库（分析期间在 0.2.x 工作区上验证；修复最终随 0.3.13 发布到 `main`，见下方说明）与 `D:\Khabarovsk\K.Develop\dsh\staging\dsh-clearview-0.3.11-fix`
- 对照内核：`@deepseek-ai/dsh 0.2.1-rc.2`（基线 `0.2.0-rc.2`）
- 结论一句话：**代码只差 1 行，但发布清单（`peerDependencies`）不改就会被 0.2.1 新增的兼容门禁直接跳过。**

> **版本口径说明**：分析期间仓库 `main` 停在内核 0.2.0-rc.2 时代的 0.2.1 基线，修复先在该基线上验证；随后 `main` 并入 0.3.x 线（`origin/main` 领先的 39 个提交 + `feat/user-image-thumb`／`fix/clearview-table-frame` 两个分支），修复重新应用到 0.3.12 之上，随 **0.3.13** 发布。0.3.12 与 0.2.1 一样缺 `commandLine`、同样精确钉死 `0.2.0-rc.2`，故两处修复在两条基线上都成立。

> **本文提出的两项修复已落地**（见第 2、3 节的「已落实」标注）：`src/client/native/primitive-labels.ts` 补 `commandLine`，`package.json` 加 `engines.dsh: "^0.2.0-rc.2"` 并把 10 条 dsh peer 放宽为 `^0.2.0-rc.2`（cordis `^4.0.4`）。落地后复验：**0.2.1-rc.2 与 0.2.0-rc.2 双向全绿**（tsc 0 错、build 通过、测试 327/327）。


---

## 0. 结论速览

| 维度 | 0.2.0-rc.2（基线） | 0.2.1-rc.2（现状） | 判定 |
| --- | --- | --- | --- |
| 类型检查 `tsc --noEmit` | 0 错误 | **1 错误**（`commandLine`） | ⚠ 破坏（可 1 行修复） |
| 构建 `npm run build` | 通过 | **失败**（卡在 tsc） | ⚠ 同上 |
| 单元测试（修后） | — | **326/326 通过**（main）/ **423/423 通过**（0.3.11） | ✅ 兼容 |
| 运行时共享模块（bundle externals） | 3 个 | 3 个，全部仍在白名单 | ✅ 兼容 |
| 宿主 CSS 变量 | 137 个 | 137 个，**增删均为 0** | ✅ 兼容 |
| 宿主 DOM/CSS 类名依赖 | 无（选择器均指向自有子树） | 无 | ✅ 兼容 |
| 清单门禁（plugin compatibility gate） | 不存在 | **存在，且会拦截本插件** | ❌ 阻塞发布 |

一句话拆解：**唯一的编译级破坏是 `TerminalBlockLabels.commandLine` 由可选变必填**；**唯一会「静默禁用」的是 10 条钉死在 `0.2.0-rc.2` 的 peer 声明**。

---

## 1. 取证方法（可复现）

仓库自带的 `npm run link:generation` 用**目录 junction** 把内核包挂进 `node_modules`。在 0.2.1 下这条路会得到**假错误**：junction 按 realpath 解析，`dsh-client-ui-conversation` 内部的 `declare module '@deepseek-ai/dsh-client-ui-slots'` 与插件看到的不是同一份文件，声明合并失效，`keyof SlotMap` 退化为 `never`，于是凭空冒出 115 行 `TS2344: Type '"conversation.view"' does not satisfy the constraint '"dsh-clearview.block"'` 之类的错误（加 `--preserveSymlinks` 探针即消失）。**结论：跨包类型比对必须在同一物理目录内进行。**

因此改用两个干净的「房间」（robocopy 源码 + `npm install --force`，peer 合并进 dependencies）：

```powershell
# 房间准备（<dir> 为源码副本目录，<dshVersion> 如 0.2.1-rc.2）
node prep-room.mjs <dir> <dshVersion> <cordisVersion>
cd <dir>
node node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
npm run build
node --import ./tests/support/register.mjs --import tsx/esm --test tests/*.test.ts
```

依赖坑（会伪装成真实错误，务必先补齐再判定）：

- 必须额外声明 `@deepseek-ai/dsh-client-store`（`src/client/store.ts:1` 直接 import）与 `@deepseek-ai/dsh-api-workspace-controller`（提供 `ctx.workspaces`）。缺它们会报 27 条 `TS7006` + `Property 'workspaces' does not exist on type 'Context'` + `Cannot find module '@deepseek-ai/dsh-client-store'`——**这些都是缺包，不是不兼容**。
- 测试需要 `react-dom` + `@types/react-dom`（`tests/style-contract.test.ts` 直接 import），否则 12 个测试文件 `ERR_MODULE_NOT_FOUND`。
- 构建需要 `DSHX_HARNESS=<harness checkout>`，否则 `tsdown.config.ts:7` 抛 `Set DSHX_HARNESS to the checkout used for this build.`

原始日志见 `.evidence/compat-0.2.1-rc.2/`（已 gitignore）。

---

## 2. 破坏点 #1：`TerminalBlockLabels.commandLine` 变为必填（唯一编译错误）

> **已落实**：`src/client/native/primitive-labels.ts` 的 `TERMINAL_LABELS` 已补 `commandLine`，并在 `tests/primitive-labels.test.ts` 加了对应断言（测试总数 326 → 327）。

**宿主改动**（`@deepseek-ai/dsh-client-ui-primitives@0.2.1-rc.2` → `lib/types/TerminalBlock.d.ts`）：

```ts
export interface TerminalBlockLabels {
  commandLine: (line: number) => string;   // 0.2.1：新增且必填（1-based 行号）
  signal: (signal: string) => string;
  // …
}
```

**插件症状**：

```text
src/client/native/labeled-blocks.tsx(58,36): error TS2322: Type '{ commandLine?: ((line: number) => string) | undefined; … }' is not assignable to type 'TerminalBlockLabels'.
  Types of property 'commandLine' are incompatible.
    Type '((line: number) => string) | undefined' is not assignable to type '(line: number) => string'.
```

原因是 `TerminalBlockL` 用 `Partial<TerminalBlockLabels>` 兜底：

```tsx
// src/client/native/labeled-blocks.tsx:57-59
export function TerminalBlockL({ labels, ...props }: Omit<TerminalBlockProps,'labels'> & { labels?: Partial<TerminalBlockProps['labels']> }): ReactNode {
  return <TerminalBlock {...props} labels={{ ...TERMINAL_LABELS, ...labels }} />;
}
```

而 `TERMINAL_LABELS`（`src/client/native/primitive-labels.ts:50`）里没有 `commandLine`。

**修复（1 行，两条产品线同一处）**：

```diff
 // src/client/native/primitive-labels.ts
   noExitCode: '无退出码',
+  commandLine: (line: number) => `第 ${line} 行命令行`,
```

**验证（两个房间各自独立完成）**：

| 房间 | 修前 | 修后 tsc | 修后 build | 修后 tests |
| --- | --- | --- | --- | --- |
| main（0.2.2） | 1 错误 / 4 行 | **0** | ✅ `lib/client.js` 1.40 MB | ✅ 326/326 |
| 0.3.11-fix | 1 错误 / 4 行 | **0** | ✅ `lib/client.js` 1.43 MB | ✅ 423/423 |

**为什么基线是干净的**：同一份源码、同一套房间脚本，只把 13 个 `@deepseek-ai/dsh-*` 换成 `0.2.0-rc.2`、cordis 换成 `4.0.4`，`tsc` 输出为空（`room-tsc-020.txt` 0 字节）。所以这 1 条不是「本来就坏」。

---

## 3. 破坏点 #2：新增的插件兼容门禁会直接跳过本插件

> **已落实**：`package.json` 已加 `"engines.dsh": "^0.2.0-rc.2"`，并把 10 条 dsh peer 放宽为 `^0.2.0-rc.2`、cordis 放宽为 `^4.0.4`。用内核真实门禁函数 `evaluatePluginCompatibility` 复验：改动前 `0.2.1-rc.2 → INCOMPATIBLE`（10 条 requirements），改动后 `0.2.1-rc.2 → COMPATIBLE`；同时 `0.3.0-rc.1`、`1.0.0` 仍被判 INCOMPATIBLE，说明范围没有放宽成"通配"。

0.2.1 起 `@deepseek-ai/dsh-app-boot` 增加了 `plugin-compatibility` 判定（`lib/index.js` 内 `evaluatePluginCompatibility` / `unmetRequirements`）：

- 若 manifest 有 **`engines.dsh`**，则**它单独决定**，`peerDependencies` 全部忽略；
- 否则遍历 `peerDependencies`，**只检查**名字为 `@deepseek-ai/dsh` 或以 `@deepseek-ai/dsh-` 开头的项，逐条 `semver.satisfies(runtime, range, { includePrerelease: true })`；
- `workspace:^|~|*` 视为「等于当前 runtime」；
- 任一不满足 → 启动时**跳过该 profile bundle**，除非在 `compatibility.json` 里给出**精确版本豁免**（键 `"<name>@<version>"`，值必须是对应的精确 SemVer 数组）。

**现场日志（`%APPDATA%\dsh-tauri\logs\web\dsh-web.log`）**：

```text
dsh: skipping profile bundle "aegis": Plugin aegis@2.13.0 is incompatible with dsh 0.2.1-rc.2: requirements {"@deepseek-ai/dsh-agent":"0.2.0-rc.2",…}.
To accept this risk explicitly, grant the exact-version exemption for aegis@2.13.0 on dsh 0.2.1-rc.2 with `dsh plugin allow-version` …
[my-plugins/dsh-clearview] loaded
```

即：**门禁确实在跑；clearview 能加载，只是因为 `profiles/web/compatibility.json` 里已手工写入 `"dsh-clearview@0.3.10": ["0.2.1-rc.2"]` 这一条精确版本豁免**（该文件由临时脚本 `fix-compat-20261020\compat.mjs` 生成，属遗留补丁）。换成 0.0.1 版本号的新构建，豁免立即失效。

**本仓库当前清单**：`package.json` 里 10 条 `@deepseek-ai/dsh-*` peer **全部精确钉死 `0.2.0-rc.2`**，cordis 钉 `4.0.4`，且**没有 `engines.dsh`** → 0.2.1-rc.2 下必然 unmet。

**semver 实测（用内核自带 semver，`includePrerelease: true`）**：

| runtime | range | 结果 |
| --- | --- | --- |
| 0.2.1-rc.2 | `0.2.0-rc.2`（现状，精确） | ❌ false |
| 0.2.1-rc.2 | `^0.2.0-rc.2` | ✅ true |
| 0.2.0-rc.2 | `^0.2.0-rc.2` | ✅ true |
| 1.0.0-rc.1 | `^0.2.0-rc.2` | ❌ false |
| 0.3.0-rc.1 | `>=0.2.0-rc.2 <0.3.0` | ⚠ true（不如 `^` 精确） |

**推荐改法（按优先级）**：

1. **加 `engines.dsh`，把 peer 降级为文档性声明**（门禁只认 engines，语义最清晰）：
   ```json
   "engines": { "node": "^22.19.0 || >=24.0.0", "dsh": "^0.2.0-rc.2" }
   ```
2. 若坚持用 peer 表达：把那 10 条改成 `^0.2.0-rc.2`、cordis 改 `^4.0.4`，即可同时满足 0.2.0-rc.2 与 0.2.1-rc.2。
3. 临时兜底：发布后让用户执行 `dsh plugin allow-version`（或插件管理器里授权），这会把精确版本写进 `compatibility.json`——**每次发版都要重做一次，不能作为长期方案**。

---

## 4. 宿主契约变了、但本插件不受影响（逐条核对）

对比了 27 个包的清单 + 约 45 份关键 `.d.ts`（`dts-diff.txt`，140 KB）。0.2.1 的破坏性变更集中在 ui-chat / ui-conversation 的 slot 契约，而**本插件恰好都在其「安全侧」**：

| 宿主变更（0.2.1） | 插件是否使用 | 依据 |
| --- | --- | --- |
| `conversation.message.images` **改名** `conversation.chat.message.images`，新增 `conversation.chat.user.images` | 否 | 插件只注册 `conversation.view` / `conversation.input.dock`，不碰 message.images |
| `ChatViewSlotProps` 的 `PropsRenderSlots<…>` 改为 `PropsRenderSlots<'conversation.chat.flow'>` | 是（`conversation.view`） | 插件从 `PropsRuntime<'conversation.view'>` 取 props，不渲染 chat.node/chat.flow 子槽 → tsc 通过 |
| 新增 `conversation.chat.flow` 槽（owner/hookContext/inject） | 否 | 未注册 |
| `ChatNodeOwnerProps` 删除 `openSkill` / `renderMessageImages` | 否 | `grep` 源码无这两个标识符 |
| `ChatViewInjected` 删除 `openSkill` | 否 | 同上 |
| `ConversationSessionInjected.bindDraftMirror` → `bindDraftPersistence` | 否 | 插件不接管输入草稿持久化 |
| `InputEvent.draft-changed` 负载 `draft` → `command: CommandClaim`；新增 `setDraft(DraftInput)` / `persistDraft` | 否 | 插件在 `conversation.input.dock` 只做「切视图」：`useStore(s => s.view)` + `actions.setView(next)`（`src/client/entry.tsx:19-25`），不碰草稿/输入编辑器 |
| 新增 `conversation.user.text` / `conversation.user.text.node` / `conversation.hero.options` / `conversation.images.content` | 否 | 未注册、未渲染 |
| `SlotEntryDef/SlotSpec` 新增 `inline?: true`（新增可选字段） | 否 | 不变式放宽，不影响既有注册 |
| `KeyedStandardSource` 增加 `member?` 形参；`keyedHooks.useName(key, selector?, equal?)` | 否 | 源码 `grep useName / keyedHooks` 均 0 命中；插件用自己的 `dsh-clearview.block`（`kind: 'chain'`）+ `renderSlotChain` |
| `dsh-client-*` 删除 `./invariant` 导出（session / jobs / workspace / modules / ui-renderer 五个包） | 否 | `grep -rn "invariant" src` 无命中 |
| `dsh-client-connection` 的 `./client` 改为 node/browser 条件导出 | 否 | 插件不直接 import connection |
| `dsh-api-session-controller` 新增 `./remote-events`、`./typert` 导出；`zod` 由 `^4.4.3` 钉死 `4.4.3` | 否 | 插件用其 `client` 入口，签名未变 |
| `dsh-web-frontend` 删除 KaTeX 字体资产 | 否 | 插件自带 `katex` 依赖，字体从自身 CSS 引用 |
| `dsh-client-ui-session` / `ui-theme` 的 `dsh.client.inject` 扩项 | 是（间接） | 插件 inject 列表自带 ui-session，扩项由宿主解析，无冲突 |

另外，`dsh-client-store`、`dsh-client-locale`、`dsh-api-job-controller` 的**类型契约在 0.2.0→0.2.1 之间完全没变**——插件依赖最重的 store/jobs 面是稳定的。

---

## 5. 运行时面核查

**共享模块白名单（bundle externals）**：0.2.1 的 `dsh-web-frontend/dist/assets/index-*.js` 内 `staticModules()` 为
`react, react/jsx-runtime, react-dom, react-dom/client, @deepseek-ai/cordis, zod, @tanstack/react-virtual, @deepseek-ai/dsh-client-store, @deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-client-ui-primitives, @deepseek-ai/dsh-client-ui-dockkit`。
插件 bundle 实测 external 只有 `@deepseek-ai/dsh-client-ui-primitives, react, react/jsx-runtime`（`scripts/check-bundle-externals.mjs` 输出），**三者全在白名单内**，0.2.0 与 0.2.1 重建结果一致。

**一个需要登记的隐患**：`@deepseek-ai/dsh-client-store` 是**未声明的直接 import**（既不在 `dependencies` 也不在 `peerDependencies`），运行时靠宿主静态表提供，构建期靠 tsdown 的 computed-require 守卫规避未定义符号。打包器不会替它报错，但如果哪天宿主把它移出静态表，问题只会在浏览器里炸。

**宿主 CSS 变量零漂移**：从两版 `dsh-web-frontend/dist` 全量提取 `--dsw-* / --dsh-* / --ds-*`，0.2.0 = 137、0.2.1 = 137，**removed 0 / added 0**；与插件实际使用的 69 个变量求交，removed = 0。插件对 `--dsh-chat-content-width`(748px)、`--dsh-composer-height`(152px) 均带 CSS fallback（`src/client/Reader.module.css:23`、`src/client/Opening.module.css:4`、`src/client/FloatingStatus.module.css:1`），且这两个变量两版都不在 dist 里（一直由运行时内联设置）。

**DOM/CSS 耦合面**：全仓 97 处选择器命中集中在自有子树，根锚点 `src/client/compat/reader-root.ts:34` `READER_ROOT_SELECTOR = '[data-dsh-clearview]'`，其余为 `section[data-reader-turn]`、`[data-reader-text][data-shown-length]`、`[data-reader-disclosure]`、`div[data-reader-anchor]`——**没有依赖宿主类名**。compat 层（`src/client/compat/index.ts`）对宿主内部 hook 全部 duck-typing + `try/catch` 降级（`[dsh-clearview:compat] <name> failed:` 只 warn 不抛），宿主内部结构变化的最坏结果是功能退化而非白屏。

**线上冒烟（只到「bundle 被服务」这一层）**：`http://127.0.0.1:3100/` 返回 200；插件以 `plugins/??<pkg>/client.js&rev=…` 分组预载（单包 URL 404 属设计如此），包含 `dsh-clearview/client.js` 的第三方分组 11.56 MB 可正常拉取；当前服务的是 `staging\dsh-clearview-0.3.11-fix` 的构建产物（bundle 内嵌该路径）。**未做浏览器内交互取证**（阅读视图实际点击/渲染），这是本次分析的唯一证据缺口。

---

## 6. 风险与建议

| 级别 | 事项 | 状态 / 建议 |
| --- | --- | --- |
| P0 | `commandLine` 编译失败 | ✅ **已修**（`TERMINAL_LABELS` 补一行 + 测试断言） |
| P0 | 10 条 peer 钉死 `0.2.0-rc.2`，0.2.1 门禁会跳过插件 | ✅ **已修**（加 `engines.dsh: "^0.2.0-rc.2"`，peer 全放宽为 `^0.2.0-rc.2`、cordis `^4.0.4`） |
| P0 | 现网靠 `compatibility.json` 手工豁免运行 | ⏳ 待办：发版后删除该豁免条目（`dsh-clearview@<ver>` 的精确版本豁免），改为清单自带范围 |
| P1 | `@deepseek-ai/dsh-client-store` 未声明依赖 | 待办：至少加进 `peerDependencies` + 文档说明「由宿主静态表提供」 |
| P1 | `dsh-client-ui-primitives` 等包 label 契约可能继续加必填项 | 待办：把 `TERMINAL_LABELS` 标注为 `satisfies TerminalBlockLabels`，让 tsc 在宿主下次加字段时立刻报错。**注意**：0.2.0 的类型无 `commandLine`，加了 `satisfies` 会在 0.2.0 上触发多余属性检查 → 必须与「只支持 0.2.1+」的版本策略同步 |
| P2 | 仓库本地 `npm run typecheck` 不可用作门禁 | 本地 pnpm 树缺 `@deepseek-ai/dsh-session/types` 等宿主包（走 `link:harness` / `link:generation` 才有），报的是 `TS2307` 级联的 `TS7006`，与代码无关 → **跨版本判定一律用干净房间** |
| P2 | 21 处 `as any / as unknown as`（compat 层 7、index.tsx 3 等） | 可接受，但建议把宿主可选服务（`sidebarRight` / `uiConversation` / `uiWorkspace` / `chatFileMentions`）的取用集中到一个 typed 适配器，附版本探测 |
| P2 | `docs/` 无兼容矩阵 | 本文件可作为 0.2.x 兼容基线，每次内核升级追加一行 |

**总判定：兼容性等级 = A（修复已落地，双向验证通过）**。代码层对 0.2.1 的适配成本极低（1 行，且不涉及 slot/渲染逻辑），真正的风险在**发布清单与门禁**这一层——不改范围的构建，在 0.2.1 上会被直接跳过而不是「报错」。

---

## 7. 已落实改动与复验结果

### 改动（3 个文件）

| 文件 | 改动 |
| --- | --- |
| `src/client/native/primitive-labels.ts` | `TERMINAL_LABELS` 增加 `commandLine: (line: number) => \`第 ${line} 行命令行\``（附注释说明 0.2.0/0.2.1 的差异与安全性） |
| `package.json` | `engines` 增加 `"dsh": "^0.2.0-rc.2"`；11 条 `@deepseek-ai/*` peer（10 个 `dsh-*` + `cordis`）由精确版本放宽为 `^0.2.0-rc.2` / `^4.0.4`（`react: "18.3.1"` 不动） |
| `tests/primitive-labels.test.ts` | 新增 `TERMINAL_LABELS.commandLine(3) === '第 3 行命令行'` 断言，并把 `commandLine` 加进「字段必须存在」的键列表 |

### 复验（干净房间，源码 = 当前工作区）

| 内核 | tsc | build | tests |
| --- | --- | --- | --- |
| **0.2.1-rc.2** + cordis 4.0.5 | **0 错误** | ✅ `lib/client.js` 1.40 MB | ✅ **327/327** |
| **0.2.0-rc.2** + cordis 4.0.4（回归） | **0 错误** | ✅ `lib/client.js` 1.40 MB | ✅ **327/327** |

0.2.0 下 `TerminalBlockLabels` **完全不声明** `commandLine`，tsc 仍 0 错 —— 证明多传该键在 0.2.0 上安全（`{...TERMINAL_LABELS, ...labels}` 的展开不经多余属性检查）。

### 门禁复验（内核真实函数 `evaluatePluginCompatibility`）

| manifest | runtime | 判定 |
| --- | --- | --- |
| HEAD（改动前） | 0.2.0-rc.2 | COMPATIBLE |
| HEAD（改动前） | **0.2.1-rc.2** | **INCOMPATIBLE**（10 条 dsh peer 精确钉死） |
| 当前工作区（改动后） | 0.2.0-rc.2 | COMPATIBLE |
| 当前工作区（改动后） | **0.2.1-rc.2** | **COMPATIBLE** |
| 当前工作区（改动后） | 0.3.0-rc.1 / 1.0.0 | INCOMPATIBLE（范围未放宽成通配） |

### 复现

```powershell
robocopy <repo> <room> /E /XD node_modules lib .git artifacts .evidence .perf-results .superpowers
node prep-room.mjs <room> 0.2.1-rc.2 4.0.5
cd <room>; npm install --force --no-audit --no-fund
node node_modules\typescript\bin\tsc -p tsconfig.json --noEmit     # 期望：0 行
$env:DSHX_HARNESS='D:\Khabarovsk\K.Develop\deepseek-harness'; npm run build
node --import ./tests/support/register.mjs --import tsx/esm --test tests/*.test.ts   # 期望：327/327
```

---

## 8. 附录：证据索引（`.evidence/compat-0.2.1-rc.2/`）

| 文件 | 内容 |
| --- | --- |
| `tsc-021.txt` | 修复后 · 0.2.1-rc.2 tsc（0 字节 = 0 错误） |
| `tests-021.txt` | 修复后 · 0.2.1-rc.2 测试（327/327） |
| `tsc-020.txt` | 回归 · 0.2.0-rc.2 tsc（0 字节） |
| `tests-020.txt` | 回归 · 0.2.0-rc.2 测试（327/327） |
| `gate-before.txt` / `gate-after.txt` | 门禁判定对照（HEAD vs 工作区，多 runtime） |
| `room-tsc-021.txt` | 修复**前** 0.2.1 tsc（1 错误 / 4 行，证明改动确实必要） |
| `room-tests-021b.txt` | 修复前 0.2.1 测试（326/326） |
| `room311-tsc-021.txt` / `room311-tests-021.txt` | 0.3.11 线 0.2.1 下的修前 tsc / 修后测试（423/423） |
| `summary.txt` / `report.json` | 27 个宿主包的清单级差异（registry 逐版本抓取对比） |
| `dts-diff.txt` / `dts-diff-stats.txt` | 约 45 份关键 `.d.ts` 的 `-U4` 统一 diff |
| `prep-room.mjs` / `gate-probe.mjs` | 房间准备与门禁复验脚本（可直接复用） |
| `build-registry-scope.mjs` / `build-scope.mjs` / `dts-diff.mjs` / `fetch-diff.mjs` / `extract.mjs` | 清单与 d.ts 差异复现脚本 |

