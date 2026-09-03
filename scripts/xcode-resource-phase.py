"""
Replaces the converter's static copy of the web extension with a build phase
that produces it.

`safari-web-extension-converter --copy-resources` snapshots the extension bundle
into the Xcode project. For a hand-written extension that is right: the copy is
the source. Here the bundle is compiled from TypeScript, so committing it means
committing build output — 12,000 lines of it, churning on every source change,
in a repository that gitignores `dist/` for exactly that reason.

Worse, the copy can go stale silently. A stale bundle still builds, the
extension still loads, and it runs last month's capture path.

So the Resources group is emptied of compiled artifacts and a Run Script phase
is added ahead of the Resources phase, which builds the bundle and syncs it in.
The phase declares its outputs so Xcode's dependency planner knows the files will
exist before anything needs them.

Idempotent. Run after scripts/xcode-wire.py.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECT = ROOT / "apple/GlassFrog Clipper/GlassFrog Clipper.xcodeproj/project.pbxproj"

# Everything tsup emits, plus the manifest and icons the build script copies.
# The icon list must match `icons` in public/manifest.json: the Safari overlay
# does not override that key, so a size declared there and missing here ships a
# manifest pointing at a file the bundle does not contain.
GENERATED = [
    "background.js",
    "options.js",
    "popup.js",
    "manifest.json",
    "popup.html",
    "options.html",
    "icon16.png",
    "icon32.png",
    "icon48.png",
    "icon128.png",
]

SCRIPT = r"""# Builds the web extension from ../../src and syncs it into this target.
#
# The bundle is compiled from TypeScript, so it is build output and is not in
# version control. Producing it here rather than committing it means it cannot
# go stale: a Safari build always ships the capture path the sources describe.
set -euo pipefail
cd "$SRCROOT/../.."

# Xcode's build environment does not inherit a login shell's PATH, so a node
# installed by nvm, fnm or Homebrew is invisible here even though it works in a
# terminal. Look in the usual places before giving up with something actionable.
if ! command -v npm >/dev/null 2>&1; then
  for candidate in "$HOME/.nvm/versions/node/"*/bin /opt/homebrew/bin /usr/local/bin; do
    [ -d "$candidate" ] && PATH="$candidate:$PATH"
  done
  export PATH
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "error: npm not found. The Safari bundle is compiled from TypeScript and cannot be built without it." >&2
  echo "note: install Node 22.18+, then build again. See apple/README.md." >&2
  exit 1
fi

npm run --silent build:safari

DEST="$SRCROOT/Shared (Extension)/Resources"
mkdir -p "$DEST"
# cp rather than rsync: rsync writes through a temp file and then calls
# utimensat, both of which Xcode's user-script sandbox refuses even for declared
# outputs.
cp -R dist-safari/. "$DEST/"
"""

text = PROJECT.read_text()

if "Build web extension" in text:
    print("resource build phase already present — nothing to do")
    sys.exit(0)

counter = iter(range(3000, 4000))
def uid():
    return f"C1AFEE{next(counter):018X}"


def extension_targets():
    for match in re.finditer(
        r"([0-9A-F]{24}) /\* (GlassFrog Clipper Extension \((?:iOS|macOS)\)) \*/ = \{\n\t\t\tisa = PBXNativeTarget;.*?\n\t\t\};",
        text,
        re.S,
    ):
        yield match.group(1), match.group(2), match.group(0)


outputs = "".join(
    f'\t\t\t\t"$(SRCROOT)/Shared (Extension)/Resources/{name}",\n' for name in GENERATED
)

for target_uuid, name, body in list(extension_targets()):
    phase = uid()
    text = text.replace(
        "/* Begin PBXShellScriptBuildPhase section */\n"
        if "/* Begin PBXShellScriptBuildPhase section */" in text
        else "/* Begin PBXSourcesBuildPhase section */\n",
        (
            "/* Begin PBXShellScriptBuildPhase section */\n"
            if "/* Begin PBXShellScriptBuildPhase section */" not in text
            else "/* Begin PBXShellScriptBuildPhase section */\n"
        )
        + f"\t\t{phase} /* Build web extension */ = {{\n"
        f"\t\t\tisa = PBXShellScriptBuildPhase;\n"
        f"\t\t\tbuildActionMask = 2147483647;\n"
        f"\t\t\tfiles = (\n\t\t\t);\n"
        f"\t\t\tinputPaths = (\n\t\t\t);\n"
        f'\t\t\tname = "Build web extension";\n'
        f"\t\t\toutputPaths = (\n{outputs}\t\t\t);\n"
        f"\t\t\trunOnlyForDeploymentPostprocessing = 0;\n"
        f"\t\t\tshellPath = /bin/sh;\n"
        f"\t\t\tshellScript = \"{SCRIPT.replace(chr(92), chr(92)*2).replace(chr(34), chr(92) + chr(34)).replace(chr(10), chr(92) + 'n')}\";\n"
        f"\t\t}};\n",
        1,
    )
    # First in the list, so the bundle exists before the Resources phase copies it.
    text = text.replace(body, body.replace("buildPhases = (\n", f"buildPhases = (\n\t\t\t\t{phase} /* Build web extension */,\n", 1), 1)
    print(f"added the web-extension build phase to {name}")

# ENABLE_USER_SCRIPT_SANDBOXING has to be off for these targets. The phase runs
# `npm`, which reads and writes node_modules and its own caches — paths a build
# phase cannot declare as inputs or outputs, and which the sandbox therefore
# denies. This is scoped to the two extension targets rather than set project-
# wide, so nothing else loses the sandbox along with them.
text = re.sub(
    r"([0-9A-F]{24} /\* (?:Debug|Release) \*/ = \{\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = \{\n)"
    r"((?:(?!\n\t\t\};).)*?INFOPLIST_FILE = \"(?:iOS|macOS) \(Extension\)/Info\.plist\";)",
    lambda m: m.group(1) + "\t\t\t\tENABLE_USER_SCRIPT_SANDBOXING = NO;\n" + m.group(2),
    text,
    flags=re.S,
)

if "/* Begin PBXShellScriptBuildPhase section */" in text and "/* End PBXShellScriptBuildPhase section */" not in text:
    text = text.replace("/* Begin PBXSourcesBuildPhase section */", "/* End PBXShellScriptBuildPhase section */\n\n/* Begin PBXSourcesBuildPhase section */", 1)

PROJECT.write_text(text)
