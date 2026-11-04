# Development

Use Node.js 26 and npm. Run commands from the repository root.

## Setup and checks

```sh
npm ci
npm test
npm run typecheck
```

Load Auto Title without saving it to Pi's settings:

```sh
pi -e ./extensions/pi-auto-title
```

Load Prompt Mode without saving it to Pi's settings:

```sh
pi -e ./extensions/pi-prompt-mode
```

## Adding an extension

Keep each extension in `extensions/<name>/` with its own package manifest,
README, changelog, tests, and MIT license copy. Declare the extension entry point
in the manifest's `pi.extensions` array. Pi loads TypeScript directly, so no
compiled output directory is needed.

Use the root lockfile rather than adding lockfiles inside individual workspaces.
The root package is private and is not published.

## Releases

Packages have independent versions. Update the extension's version and changelog,
then update the root lockfile and run the checks:

```sh
npm install --package-lock-only --ignore-scripts
npm ci
npm test
npm run typecheck
```

For Auto Title, inspect the package contents and create a tarball:

```sh
npm pack --dry-run --workspace @nimanzik/pi-auto-title
npm pack --workspace @nimanzik/pi-auto-title --pack-destination /tmp
```

The package should include only its TypeScript source, README, changelog,
manifest, and license. Tests and internal agent documentation are excluded.

Extract the tarball into a temporary directory. Run `pi -e` with the path to the
extracted `package` directory. With your configured provider, check that the
extension generates titles and preserves manual titles.

After review and npm authentication, publish from an account with permission to
use `@nimanzik`:

```sh
npm publish --workspace @nimanzik/pi-auto-title --access public
```

For Prompt Mode, use the same steps with `@nimanzik/pi-prompt-mode`. Before
publishing, check `/mode`, `Alt+O`, `Alt+N`, mode editing, and prompt history in
the extracted package. Publish with:

```sh
npm publish --workspace @nimanzik/pi-prompt-mode --access public
```

After the first release, update the installation instructions in both READMEs
to remove the unpublished notice.
