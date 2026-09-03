"""
Attaches Configurations/Signing.xcconfig to the project's build configurations.

Without this the signing team is set by hand in Xcode's target editor, which
works exactly once. The project is generated: xcode-bootstrap.sh deletes
`apple/GlassFrog Clipper` and rebuilds it from safari-web-extension-converter,
so a hand-set DEVELOPMENT_TEAM is destroyed the next time anyone regenerates —
and regenerating is the documented way to "recover a project that has been
edited into a state nobody can explain". The team would then be missing with no
compile error to say so: the app still builds, and the App Group and shared
Keychain silently stop resolving. That is the same quiet failure the entitlements
exist to prevent, which is why the team is wired the same way they are.

Attached to the two *project-level* configurations, not to each target's. No
target defines DEVELOPMENT_TEAM, so one value at the project level is inherited
by all six — and by a seventh added later, which a per-target list would miss.

The identifier itself is not here and not in Signing.xcconfig. It belongs to
whoever is signing rather than to the repository, so Signing.xcconfig optionally
includes a gitignored Local.xcconfig. With none present nothing is set and the
build is unsigned, which is what CI and ./scripts/verify-apple.sh want.

Idempotent. Run after scripts/xcode-wire.py.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECT = ROOT / "apple/GlassFrog Clipper/GlassFrog Clipper.xcodeproj/project.pbxproj"

text = PROJECT.read_text()

if "baseConfigurationReference" in text:
    print("signing xcconfig already wired — nothing to do")
    sys.exit(0)

# 4000-4999. xcode-wire.py takes 1-899, xcode-add-share.py 1000-1999 and
# xcode-resource-phase.py 3000-3999; overlapping would collide two objects onto
# one UUID and produce a project that opens but is missing whichever lost.
counter = iter(range(4000, 5000))
def uid():
    return f"C1AFEE{next(counter):018X}"


def insert_after_section(section, addition):
    global text
    marker = f"/* Begin {section} section */\n"
    assert marker in text, section
    text = text.replace(marker, marker + addition, 1)


def insert_into(uuid, key, entry, isa):
    global text
    anchor = re.escape(uuid) + r"(?: /\* [^*]* \*/)? = \{\n\t\t\tisa = " + re.escape(isa) + ";"
    match = re.search(anchor + r"(.*?" + re.escape(key) + r" = \(\n)", text, re.S)
    assert match, f"{key} not found for {uuid} ({isa})"
    text = text[: match.end(1)] + entry + text[match.end(1) :]


# Every UUID below is read out of the project rather than hardcoded: the
# converter mints new ones on each bootstrap, so a literal would be stale the
# first time this script mattered.
project_block = re.search(r"[0-9A-F]{24} /\* Project object \*/ = \{\n\t\t\tisa = PBXProject;.*?\n\t\t\};", text, re.S)
assert project_block, "PBXProject not found"

main_group = re.search(r"mainGroup = ([0-9A-F]{24})", project_block.group(0))
assert main_group, "mainGroup not found"

config_list = re.search(r"buildConfigurationList = ([0-9A-F]{24})", project_block.group(0))
assert config_list, "project buildConfigurationList not found"

list_block = re.search(
    re.escape(config_list.group(1)) + r"(?: /\* [^*]* \*/)? = \{\n\t\t\tisa = XCConfigurationList;.*?\n\t\t\};",
    text,
    re.S,
)
assert list_block, "project XCConfigurationList not found"
project_configs = re.findall(r"([0-9A-F]{24}) /\* (?:Debug|Release) \*/", list_block.group(0))
assert project_configs, "no project-level build configurations found"

# --------------------------------------------------------------- the xcconfig
file_ref = uid()
group_ref = uid()

insert_after_section(
    "PBXFileReference",
    f'\t\t{file_ref} /* Signing.xcconfig */ = {{isa = PBXFileReference; '
    f'lastKnownFileType = text.xcconfig; path = Signing.xcconfig; sourceTree = "<group>"; }};\n',
)

# A real group, so the file is editable in Xcode rather than only from a text
# editor. `path` makes it resolve to Configurations/ beside the project.
insert_after_section(
    "PBXGroup",
    f"\t\t{group_ref} /* Configurations */ = {{\n"
    f"\t\t\tisa = PBXGroup;\n"
    f"\t\t\tchildren = (\n"
    f"\t\t\t\t{file_ref} /* Signing.xcconfig */,\n"
    f"\t\t\t);\n"
    f"\t\t\tpath = Configurations;\n"
    f'\t\t\tsourceTree = "<group>";\n'
    f"\t\t}};\n",
)

insert_into(main_group.group(1), "children", f"\t\t\t\t{group_ref} /* Configurations */,\n", "PBXGroup")

# ------------------------------------------------------- attach to the project
for config in project_configs:
    anchor = re.escape(config) + r"(?: /\* [^*]* \*/)? = \{\n\t\t\tisa = XCBuildConfiguration;\n"
    match = re.search(anchor, text)
    assert match, f"build configuration not found: {config}"
    # First key in the object, which is where Xcode itself writes it.
    text = (
        text[: match.end()]
        + f"\t\t\tbaseConfigurationReference = {file_ref} /* Signing.xcconfig */;\n"
        + text[match.end() :]
    )

PROJECT.write_text(text)
print(f"signing xcconfig wired into {len(project_configs)} project-level configurations")
