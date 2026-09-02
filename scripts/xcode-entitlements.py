"""
Points every target at the shared entitlements file for its platform.

The converter generates no entitlements at all, because a plain Safari web
extension needs none. This project does: the app, the Safari handler and the
Share Extension have to reach one App Group and one Keychain item, or the
practitioner configures the same thing twice and the share sheet still cannot
file.

Applied by build configuration rather than by target, because SDKROOT is what
distinguishes an iOS configuration from a macOS one here — the two apps share
target names that differ only by a suffix, and matching on that would be a
naming coincidence rather than a fact about the build.

Idempotent. Run after scripts/xcode-add-share.py.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECT = ROOT / "apple/GlassFrog Clipper/GlassFrog Clipper.xcodeproj/project.pbxproj"

text = PROJECT.read_text()

if "CODE_SIGN_ENTITLEMENTS" in text:
    print("entitlements already wired — nothing to do")
    sys.exit(0)

applied = {"iphoneos": 0, "macosx": 0}


def add_entitlements(match):
    body = match.group(0)
    sdk = re.search(r"SDKROOT = (\w+);", body)
    if not sdk or sdk.group(1) not in applied:
        return body
    platform = "iOS" if sdk.group(1) == "iphoneos" else "macOS"
    applied[sdk.group(1)] += 1
    # Inserted in sorted position: build settings are written alphabetically,
    # and a stray key breaks the pattern for whoever reads this next.
    return body.replace(
        "\t\t\t\tCODE_SIGN_STYLE = Automatic;",
        f'\t\t\t\tCODE_SIGN_ENTITLEMENTS = "Entitlements/{platform}.entitlements";\n'
        "\t\t\t\tCODE_SIGN_STYLE = Automatic;",
        1,
    )


text = re.sub(
    r"[0-9A-F]{24} /\* (?:Debug|Release) \*/ = \{\n\t\t\tisa = XCBuildConfiguration;.*?\n\t\t\};",
    add_entitlements,
    text,
    flags=re.S,
)

PROJECT.write_text(text)
print(f"entitlements wired into {applied['iphoneos']} iOS and {applied['macosx']} macOS configurations")
