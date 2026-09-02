"""
Attaches everything this repository adds on top of the converter-generated
Xcode project.

`safari-web-extension-converter` produces a correct project for a Safari web
extension and nothing more: two apps, two extension handlers, and a copy of the
web bundle. It knows nothing about the shared Swift core, the settings screen,
or the share sheet. This script adds those, and is the reason
`apple/README.md` can say "regenerate and re-run" rather than "reproduce
thirty clicks in Xcode from memory".

The core is compiled **into** each target rather than linked as a Swift package
product. The package in `apple/GlassFrogClipperCore` remains the canonical home
for those sources and is what `swift test` runs — including the cross-language
compose contract — but Xcode links a local package product into an app
extension only when a good deal of additional pbxproj state is exactly right,
and getting it subtly wrong fails at `import` with an error that names the
import rather than the cause. Compiling shared sources into an app and its
extensions is the ordinary pattern for exactly this situation, and it cannot
half-work.

Idempotent: running it twice is a no-op.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECT = ROOT / "apple/GlassFrog Clipper/GlassFrog Clipper.xcodeproj/project.pbxproj"

CORE_DIR = "../GlassFrogClipperCore/Sources/GlassFrogClipperCore"
CORE_FILES = [
    "Capture.swift", "CaptureFiler.swift", "Compose.swift", "Configuration.swift",
    "Failure.swift", "GlassFrogClient.swift", "Keychain.swift", "NativeMessage.swift",
    "Notifier.swift",
]
APP_FILES = ["SettingsModel.swift", "SettingsView.swift"]

# Every identifier below is discovered from the file rather than written down.
# The converter assigns fresh UUIDs on every run, so a hardcoded map is correct
# exactly once — and fails at the next regeneration with an assertion rather
# than a wrong edit, which is the better of the two failures but still a
# needless one.
TARGET_NAMES = {
    "iOS (App)": "GlassFrog Clipper (iOS)",
    "macOS (App)": "GlassFrog Clipper (macOS)",
    "iOS (Ext)": "GlassFrog Clipper Extension (iOS)",
    "macOS (Ext)": "GlassFrog Clipper Extension (macOS)",
}
APP_TARGETS = ["iOS (App)", "macOS (App)"]

text = PROJECT.read_text()


def find_group(name):
    """The UUID of the PBXGroup with this path or name."""
    pattern = re.compile(
        r"([0-9A-F]{24}) /\* " + re.escape(name) + r" \*/ = \{\n\t\t\tisa = PBXGroup;"
    )
    match = pattern.search(text)
    assert match, f"group not found: {name}"
    return match.group(1)


def find_main_group():
    match = re.search(r"mainGroup = ([0-9A-F]{24});", text)
    assert match, "mainGroup not found"
    return match.group(1)


def find_target_sources(display_name):
    """The Sources build-phase UUID belonging to one native target."""
    block = re.search(
        r"[0-9A-F]{24} /\* " + re.escape(display_name) + r" \*/ = \{\n\t\t\tisa = PBXNativeTarget;.*?\n\t\t\};",
        text,
        re.S,
    )
    assert block, f"target not found: {display_name}"
    phase = re.search(r"([0-9A-F]{24}) /\* Sources \*/", block.group(0))
    assert phase, f"Sources phase not found for {display_name}"
    return phase.group(1)


GROUP_MAIN = find_main_group()
GROUP_SHARED_APP = find_group("Shared (App)")
TARGETS = {key: (None, find_target_sources(name)) for key, name in TARGET_NAMES.items()}

# ------------------------------------------------------- deployment floors
#
# Raised from the converter's defaults (macOS 10.14, iOS 15.0), which predate
# everything this app is built from: `@Observable` and `ContentUnavailableView`
# are iOS 17 / macOS 14. Not arbitrary — `public/manifest.safari.json` puts the
# Safari floor at 18.0, and Safari 18 runs on macOS 14 and later, so anything
# lower would be a platform we claim to support and cannot build for.
before = text
text = text.replace("MACOSX_DEPLOYMENT_TARGET = 10.14;", "MACOSX_DEPLOYMENT_TARGET = 14.0;")
text = text.replace("IPHONEOS_DEPLOYMENT_TARGET = 15.0;", "IPHONEOS_DEPLOYMENT_TARGET = 17.0;")
if text != before:
    print("raised deployment floors to macOS 14.0 / iOS 17.0")

if "GlassFrogClipperCore/Sources" in text:
    PROJECT.write_text(text)
    print("sources already wired — nothing further to do")
    sys.exit(0)


def uid(n):
    """Outside the converter's ID space, so a regenerated project cannot collide.

    Hex only. Every lookup in these scripts matches object identifiers with
    `[0-9A-F]{24}`, so a mnemonic prefix containing a non-hex letter produces
    identifiers Xcode accepts and the scripts themselves cannot find again.
    """
    return f"C1AFEE{n:018X}"


counter = iter(range(1, 900))


def insert_into_list(anchor_uuid, key, entry, isa=None):
    """Insert one line into a `<key> = ( … );` list belonging to `anchor_uuid`.

    `isa` is not optional in spirit. A build-phase UUID appears twice in the
    file — once in its owning target's `buildPhases` list, and once at its own
    definition — and the first of those comes first in the file. Anchoring on
    the UUID alone therefore finds the target's list and then the *next*
    `files = (` after it, which belongs to a different phase entirely. That
    failure is silent: the project still lints, and the sources land in the
    Resources phase of some other target.
    """
    global text
    anchor = re.escape(anchor_uuid)
    if isa:
        # The comment is optional: the project's root group is written without
        # one, as `UUID = {`, while every other object carries `/* name */`.
        anchor += r"(?: /\* [^*]* \*/)? = \{\n\t\t\tisa = " + re.escape(isa) + ";"
    pattern = re.compile(anchor + r"(.*?" + re.escape(key) + r" = \(\n)", re.S)
    match = pattern.search(text)
    assert match, f"could not find {key} for {anchor_uuid} ({isa})"
    text = text[: match.end(1)] + entry + text[match.end(1) :]


build_files, file_refs, group_children = [], [], []


def add_source(filename, path, targets, group_entries):
    ref = uid(next(counter))
    file_refs.append(
        f"\t\t{ref} /* {filename} */ = {{isa = PBXFileReference; "
        f'lastKnownFileType = sourcecode.swift; name = {filename}; path = "{path}"; '
        f'sourceTree = "<group>"; }};\n'
    )
    group_entries.append(f"\t\t\t\t{ref} /* {filename} */,\n")
    for name in targets:
        _, sources = TARGETS[name]
        bf = uid(next(counter))
        build_files.append(
            f"\t\t{bf} /* {filename} in Sources */ = "
            f"{{isa = PBXBuildFile; fileRef = {ref} /* {filename} */; }};\n"
        )
        insert_into_list(
            sources, "files", f"\t\t\t\t{bf} /* {filename} in Sources */,\n",
            isa="PBXSourcesBuildPhase",
        )


core_group_entries = []
for filename in CORE_FILES:
    add_source(filename, f"{CORE_DIR}/{filename}", list(TARGETS), core_group_entries)

app_group_entries = []
for filename in APP_FILES:
    add_source(filename, filename, APP_TARGETS, app_group_entries)

# A group of its own, so the shared core reads as shared rather than as loose
# files someone dropped into the app.
core_group = uid(next(counter))
group_children.append(
    f"\t\t{core_group} /* Shared (Core) */ = {{\n"
    f"\t\t\tisa = PBXGroup;\n"
    f"\t\t\tchildren = (\n{''.join(core_group_entries)}\t\t\t);\n"
    f'\t\t\tname = "Shared (Core)";\n'
    f'\t\t\tsourceTree = "<group>";\n'
    f"\t\t}};\n"
)

text = text.replace("/* Begin PBXBuildFile section */\n", "/* Begin PBXBuildFile section */\n" + "".join(build_files), 1)
text = text.replace("/* Begin PBXFileReference section */\n", "/* Begin PBXFileReference section */\n" + "".join(file_refs), 1)
text = text.replace("/* Begin PBXGroup section */\n", "/* Begin PBXGroup section */\n" + "".join(group_children), 1)

insert_into_list(GROUP_MAIN, "children", f"\t\t\t\t{core_group} /* Shared (Core) */,\n", isa="PBXGroup")
for entry in app_group_entries:
    insert_into_list(GROUP_SHARED_APP, "children", entry, isa="PBXGroup")

PROJECT.write_text(text)
print(f"compiled {len(CORE_FILES)} core sources into {len(TARGETS)} targets")
print(f"added {len(APP_FILES)} settings sources to the two app targets")
