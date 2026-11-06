import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";

const source = stripTypeScriptTypes(await readFile(new URL("./prompt-mode.ts", import.meta.url), "utf8"));

async function setup(t, configuration, options = {}) {
  const directory = options.directory ?? await mkdtemp(join(tmpdir(), "pi-prompt-mode-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const projectDir = join(directory, ".pi");
  await mkdir(projectDir, { recursive: true });
  const configPath = configuration === undefined
    ? join(directory, "global", "modes.json") : join(projectDir, "modes.json");
  if (configuration !== undefined) await writeFile(configPath, JSON.stringify(configuration));
  const context = createContext({
    process: { pid: process.pid, env: { PI_CODING_AGENT_DIR: join(directory, "global") } },
    setTimeout, Buffer,
  });
  const module = new SourceTextModule(`${source}\nexport { atomicWriteUtf8, renameModeUI, loadPromptHistoryForCwd, applyEditor };`, { context });
  await module.link(async (specifier) => {
    const exports = specifier === "@earendil-works/pi-coding-agent"
      ? {
        CustomEditor: class {}, getAgentDir: () => join(directory, "global"),
        keyHint: (key, label) => `${key} ${label}`,
        rawKeyHint: (key, label) => `${key} ${label}`,
      }
      : specifier === "@earendil-works/pi-tui"
        ? await import(specifier)
        : specifier === "node:fs/promises"
          ? { default: { ...(await import(specifier)).default, ...options.fs } }
          : await import(specifier);
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  const commands = {};
  const events = {};
  const shortcuts = {};
  let thinking = "max";
  const model = { provider: "test", id: "reasoning-model", reasoning: true };
  const appliedModels = [];
  const pi = {
    registerCommand: (name, definition) => { commands[name] = definition.handler; },
    registerShortcut: (key, definition) => { shortcuts[key] = definition.handler; },
    on: (event, handler) => { events[event] = handler; },
    getThinkingLevel: () => thinking,
    setThinkingLevel: (value) => { thinking = value; },
    setModel: async (value) => { appliedModels.push(value); return true; },
  };
  module.namespace.default(pi);
  const ctx = {
    cwd: directory,
    hasUI: false,
    model,
    modelRegistry: { find: (provider, id) => provider === model.provider && id === model.id ? model : undefined },
    sessionManager: { getBranch: () => [], getSessionFile: () => undefined },
  };
  return {
    commands, events, shortcuts, ctx, configPath, appliedModels, pi, helpers: module.namespace,
    get thinking() { return thinking; },
    config: async () => JSON.parse(await readFile(configPath, "utf8")),
  };
}

test("registers the command and shortcuts, and stores max thinking in project configuration", async (t) => {
  const app = await setup(t, { version: 1, modes: { fast: { thinkingLevel: "off" } } });
  assert.deepEqual(Object.keys(app.commands), ["mode"]);
  assert.deepEqual(Object.keys(app.shortcuts), ["alt+o", "alt+n"]);
  await app.events.session_start({ reason: "new" }, app.ctx);
  await app.commands.mode("store review", app.ctx);
  const config = await app.config();
  assert.deepEqual(config.modes.review, {
    provider: "test", modelId: "reasoning-model", thinkingLevel: "max",
  });
  assert.equal(config.modes.default.thinkingLevel, "max");
  await app.commands.mode("fast", app.ctx);
  assert.equal(app.thinking, "off");
  assert.equal((await app.config()).currentMode, "fast");
  await app.commands.mode("review", app.ctx);
  assert.equal(app.thinking, "max");
});

test("loads a max preset and applies default rather than the last selection to a new session", async (t) => {
  const app = await setup(t, {
    version: 1,
    currentMode: "fast",
    modes: {
      default: { provider: "test", modelId: "reasoning-model", thinkingLevel: "max" },
      fast: { provider: "test", modelId: "reasoning-model", thinkingLevel: "off" },
    },
  });
  await app.events.session_start({ reason: "new" }, app.ctx);
  assert.equal(app.thinking, "max");
  assert.equal((await app.config()).currentMode, "default");
  assert.equal(app.appliedModels.length, 1);
});

test("rejects invalid configuration without replacing it", async (t) => {
  const invalid = { version: 1, modes: { default: { thinkingLevel: "invalid" } } };
  const app = await setup(t, invalid);
  await assert.rejects(app.events.session_start({ reason: "new" }, app.ctx), /Invalid mode thinking level/);
  assert.deepEqual(await app.config(), invalid);
});

for (const code of ["EEXIST", "EPERM", "EIO"]) {
  test(`failed replacement (${code}) preserves the original configuration`, async (t) => {
    const original = { version: 1, currentMode: "default", modes: { default: {} } };
    const failure = Object.assign(new Error("replacement failed"), { code });
    let attempts = 0;
    const app = await setup(t, original, { fs: { rename: async () => { attempts++; throw failure; } } });
    await app.events.session_start({ reason: "reload" }, app.ctx);
    await assert.rejects(app.commands.mode("store review", app.ctx), (error) => error === failure);
    assert.deepEqual(await app.config(), original);
    assert.equal(attempts, 1);
    assert.deepEqual(await readdir(join(app.ctx.cwd, ".pi")), ["modes.json"]);
  });
}

test("first use saves defaults and reload retains the initial selection", async (t) => {
  const app = await setup(t);
  await app.events.session_start({ reason: "new" }, app.ctx);
  const initial = await app.config();
  assert.equal(initial.modes.default.modelId, "reasoning-model");
  assert.equal(initial.modes.default.thinkingLevel, "max");
  const reloaded = await setup(t, undefined, { directory: app.ctx.cwd });
  reloaded.ctx.model = { provider: "other", id: "other-model", reasoning: true };
  await reloaded.events.session_start({ reason: "reload" }, reloaded.ctx);
  await reloaded.commands.mode("default", reloaded.ctx);
  assert.deepEqual(await reloaded.config(), initial);
  assert.equal(reloaded.appliedModels[0].id, "reasoning-model");
});

test("rename preserves saved, runtime, and reloaded cycling order", async (t) => {
  const app = await setup(t, {
    version: 1, currentMode: "default",
    modes: { default: { thinkingLevel: "max" }, fast: { thinkingLevel: "off" }, review: { thinkingLevel: "high" } },
  });
  await app.events.session_start({ reason: "reload" }, app.ctx);
  app.ctx.hasUI = true;
  app.ctx.ui = { input: async () => "quick", notify() {} };
  await app.helpers.renameModeUI(app.pi, app.ctx, "fast");
  const saved = await app.config();
  assert.deepEqual(Object.keys(saved.modes), ["default", "quick", "review"]);
  await app.commands.mode("default", app.ctx);
  await app.shortcuts["alt+n"](app.ctx);
  assert.equal(app.thinking, "off");
  const reloaded = await setup(t, saved);
  await reloaded.events.session_start({ reason: "new" }, reloaded.ctx);
  reloaded.ctx.hasUI = true;
  reloaded.ctx.ui = { notify() {} };
  await reloaded.shortcuts["alt+n"](reloaded.ctx);
  assert.equal(reloaded.thinking, "off");
  assert.deepEqual(Object.keys((await reloaded.config()).modes), ["default", "quick", "review"]);
});

test("only a missing history directory is treated as empty", async (t) => {
  const app = await setup(t);
  const history = await app.helpers.loadPromptHistoryForCwd(app.ctx.cwd, join(app.ctx.cwd, "missing"));
  assert.equal(history.length, 0);
  for (const code of ["EACCES", "EIO"]) {
    const failure = Object.assign(new Error("read failed"), { code });
    const broken = await setup(t, undefined, { fs: { readdir: async () => { throw failure; } } });
    await assert.rejects(broken.helpers.loadPromptHistoryForCwd(broken.ctx.cwd, "sessions"), (error) => error === failure);
  }
});

for (const malformed of ["header", "record"]) {
  test(`malformed history ${malformed} reports the affected file at the UI boundary`, async (t) => {
    const app = await setup(t);
    const sessionDir = join(app.ctx.cwd, "sessions");
    await mkdir(sessionDir);
    const sessionFile = join(sessionDir, "bad.jsonl");
    const header = JSON.stringify({ type: "session", cwd: app.ctx.cwd });
    await writeFile(sessionFile, malformed === "header" ? "broken\n" : `${header}\nbroken\n`);
    app.ctx.hasUI = true;
    app.ctx.sessionManager.getSessionDir = () => sessionDir;
    let installs = 0;
    let notified;
    const notification = new Promise((resolve) => { notified = resolve; });
    app.ctx.ui = {
      theme: {}, getEditorText: () => "", setEditorComponent: () => { installs++; },
      notify: (message, level) => notified({ message, level }),
    };
    app.helpers.applyEditor(app.pi, app.ctx);
    const result = await notification;
    assert.equal(result.level, "error");
    assert.ok(result.message.includes(sessionFile));
    assert.equal(installs, 1);
  });
}

test("history directory failures reach the UI boundary", async (t) => {
  const app = await setup(t, undefined, {
    fs: { readdir: async () => { throw Object.assign(new Error("permission denied"), { code: "EACCES" }); } },
  });
  app.ctx.hasUI = true;
  app.ctx.sessionManager.getSessionDir = () => "unreadable-sessions";
  let notified;
  const notification = new Promise((resolve) => { notified = resolve; });
  app.ctx.ui = {
    theme: {}, getEditorText: () => "", setEditorComponent() {},
    notify: (message, level) => notified({ message, level }),
  };
  app.helpers.applyEditor(app.pi, app.ctx);
  const result = await notification;
  assert.equal(result.level, "error");
  assert.match(result.message, /unreadable-sessions/);
});

test("valid history loads only matching sessions and excludes the current file", async (t) => {
  const app = await setup(t);
  const sessionDir = join(app.ctx.cwd, "sessions");
  await mkdir(sessionDir);
  const current = join(sessionDir, "current.jsonl");
  for (const [name, cwd] of [["previous", app.ctx.cwd], ["current", app.ctx.cwd], ["foreign", "elsewhere"]]) {
    await writeFile(join(sessionDir, `${name}.jsonl`), [
      JSON.stringify({ type: "session", cwd }),
      JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: name }], timestamp: 123 } }),
      "",
    ].join("\n"));
  }
  const history = await app.helpers.loadPromptHistoryForCwd(app.ctx.cwd, sessionDir, current);
  assert.deepEqual(JSON.parse(JSON.stringify(history)), [{ text: "previous", timestamp: 123 }]);
});

test("configuration stat failures propagate instead of selecting another configuration", async (t) => {
  const failure = Object.assign(new Error("permission denied"), { code: "EACCES" });
  const app = await setup(t, undefined, { fs: { stat: async () => { throw failure; } } });
  await assert.rejects(app.events.session_start({ reason: "new" }, app.ctx), (error) => error === failure);
});

test("mode picker wraps arrow navigation and supports selection and cancellation", async (t) => {
  const app = await setup(t, { version: 1, modes: {
    default: { thinkingLevel: "max" }, fast: { thinkingLevel: "off" },
  } });
  app.ctx.hasUI = true;
  let configureOpened = false;
  let keys = ["\x1b[A", "\r"];
  app.ctx.ui = {
    custom: async (factory) => {
      let result;
      const component = factory(
        { terminal: { rows: 24 }, requestRender() {} },
        { fg: (_color, text) => text, bold: (text) => text },
        (await import("@earendil-works/pi-tui")).getKeybindings(), (value) => { result = value; },
      );
      const lines = component.render(80);
      assert.equal(lines[0], "─".repeat(80));
      assert.equal(lines.at(-1), lines[0]);
      assert.match(lines[4], /→ default/);
      assert.match(lines.at(-3), /↑↓ navigate.*select.*cancel/);
      for (const key of keys) component.handleInput(key);
      return result;
    },
    select: async (title) => {
      assert.equal(title, "Configure modes");
      configureOpened = true;
      return undefined;
    },
  };
  // Up from the first option wraps to Configure modes; cancel on returning.
  const originalCustom = app.ctx.ui.custom;
  app.ctx.ui.custom = async (...args) => {
    const result = await originalCustom(...args);
    keys = ["\x1b"];
    return result;
  };
  await app.commands.mode("", app.ctx);
  assert.equal(configureOpened, true);
  // Down from the last option wraps to default.
  app.pi.setThinkingLevel("off");
  keys = ["\x1b[A", "\x1b[B", "\r"];
  await app.shortcuts["alt+o"](app.ctx);
  assert.equal(app.thinking, "max");
});

test("mode picker fits short terminals and preserves selection while resizing", async (t) => {
  const app = await setup(t, { version: 1, modes: Object.fromEntries(
    ["default", ...Array.from({ length: 10 }, (_, i) => `mode${i}`)].map((name) => [name, {}]),
  ) });
  app.ctx.hasUI = true;
  app.ctx.ui = {
    custom: async (factory) => {
      const terminal = { rows: 12 };
      const keybindings = (await import("@earendil-works/pi-tui")).getKeybindings();
      const component = factory(
        { terminal, requestRender() {} },
        { fg: (_color, text) => text, bold: (text) => text },
        { matches: (data, action) =>
          (data === "h" && action === "tui.select.up") ||
          (data === "l" && action === "tui.select.down") || keybindings.matches(data, action) },
        () => {},
      );
      const check = (selected, itemCount) => {
        const lines = component.render(80);
        assert.ok(lines.length <= terminal.rows);
        assert.equal(lines.slice(4, -4).length, itemCount + 1);
        assert.ok(lines.some((line) => line.includes(`→ ${selected}`)));
        return lines;
      };
      assert.ok(check("default", 3).some((line) => line.includes("(1/12)")));
      component.handleInput("k");
      assert.ok(check("Configure modes…", 3).some((line) => line.includes("(12/12)")));
      component.handleInput("j");
      check("default", 3);
      component.handleInput("h");
      check("Configure modes…", 3);
      component.handleInput("l");
      check("default", 3);
      for (let i = 0; i < 6; i++) component.handleInput("j");
      check("mode5", 3);
      terminal.rows = 24;
      check("mode5", 10);
      terminal.rows = 10;
      check("mode5", 1);
      component.handleInput("k");
      check("mode4", 1);
      component.handleInput("\x1b");
      return undefined;
    },
  };
  await app.commands.mode("", app.ctx);
});
