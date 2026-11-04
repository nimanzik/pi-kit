# pi-prompt-mode

A Pi extension for switching between named model and thinking presets. The current
mode appears in the prompt editor border. Prompt history includes recent prompts
from other sessions in the same working directory.

## Installation

Install the published package with:

```sh
pi install npm:@nimanzik/pi-prompt-mode
```

The extension replaces Pi's prompt editor component. Avoid loading it alongside
another extension that replaces the editor.

## Mode selection

Use `/mode` or `Alt+O` to select a mode or open the configuration menu. Use `Alt+N`
to cycle through modes in configuration order.

```text
/mode                # select a mode or configure modes
/mode <name>         # apply a saved mode
/mode store [name]   # save the current model and thinking level
```

`/mode <name>` applies a saved mode. `/mode store [name]` saves the current model
and thinking level into a mode, creating it if needed. Without a name, it
opens a mode picker.

The configuration menu lets you add, rename, edit, and delete modes. The `default`
mode cannot be renamed or deleted. On first use, `default` captures the current
model and thinking level, and `fast` uses the same model with thinking off.

New sessions apply `default`. Resumed sessions match their model and thinking
level to a saved mode when possible. Manual model or thinking changes display
`custom`, which is temporary and is never saved as a mode. From `custom`, choosing
a mode offers to use it or store your current selection into it.

## Configuration

Modes are stored in `~/.pi/agent/modes.json`. If `PI_CODING_AGENT_DIR` is set, the
extension uses that directory instead. An existing `.pi/modes.json` in the current
working directory takes precedence over the global file; the files are not merged.

You can edit the file directly:

```json
{
  "version": 1,
  "currentMode": "default",
  "modes": {
    "default": {
      "provider": "your-provider",
      "modelId": "your-model-id",
      "thinkingLevel": "high"
    },
    "fast": {
      "provider": "your-provider",
      "modelId": "your-model-id",
      "thinkingLevel": "off",
      "color": "accent"
    }
  }
}
```

Model and provider names must match Pi's model registry, with credentials already
configured. Thinking levels are `off`, `minimal`, `low`, `medium`, `high`,
`xhigh`, and `max`; Pi may reduce the level to one supported by the model.
Omitted fields leave the corresponding selection unchanged. The optional `color`
is a Pi theme color token; otherwise the border follows the current thinking level.

`currentMode` records the last successful mode selection, but does not replace
`default` as the starting mode for new sessions. Mode edits are merged with the
latest file under a lock to avoid overwriting unrelated edits from other sessions.

## Prompt history

The editor combines prompts from the current session with up to 30 recent prompts
from other session files for the same working directory. It keeps up to 100
entries after sorting and removing duplicates. Only the last 256 KiB of each
previous session file is read, so older prompts in large sessions may be omitted.
History stays local and does not make additional model requests.
