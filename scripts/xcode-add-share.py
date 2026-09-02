"""
Adds the iOS and macOS Share Extension targets.

The converter scaffolds a Safari web extension and its two host apps. The share
sheet is not part of that scaffold and has to be built here.

It matters more than an "extra" target sounds. On iPhone and iPad the share
sheet is the *primary* capture path, not a secondary one: there is no keyboard
shortcut to press, and Safari is only one of the apps a practitioner senses
something in. STRATEGY.md sequenced a "mobile share-sheet companion" under the
Capture surface track, and this is it.

Each new target is cloned from the Safari extension target for the same
platform, so it inherits sandbox, hardened-runtime and app-group settings that
are already correct rather than being re-derived from memory. What changes is
the Info.plist, the bundle identifier, the product name, and the sources.

Idempotent. Run after scripts/xcode-wire.py.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECT = ROOT / "apple/GlassFrog Clipper/GlassFrog Clipper.xcodeproj/project.pbxproj"

SHARE_SOURCES = ["ShareViewController.swift", "ShareCaptureView.swift", "ShareCaptureModel.swift", "SharedItem.swift"]
CORE_DIR = "../GlassFrogClipperCore/Sources/GlassFrogClipperCore"
CORE_FILES = [
    "Capture.swift", "CaptureFiler.swift", "Compose.swift", "Configuration.swift",
    "Failure.swift", "GlassFrogClient.swift", "Keychain.swift", "NativeMessage.swift",
    "Notifier.swift",
]

PLATFORMS = [
    # key, host app target name, template extension target name, sdk
    ("iOS", "GlassFrog Clipper (iOS)", "GlassFrog Clipper Extension (iOS)"),
    ("macOS", "GlassFrog Clipper (macOS)", "GlassFrog Clipper Extension (macOS)"),
]

text = PROJECT.read_text()

if "Share Extension (iOS)" in text:
    print("share extensions already present — nothing to do")
    sys.exit(0)

counter = iter(range(1000, 2000))
def uid(n=None):
    return f"C1AFEE{(n if n is not None else next(counter)):018X}"


def block(uuid):
    """The full text of one object, from its UUID line to its closing brace."""
    match = re.search(re.escape(uuid) + r"(?: /\* [^*]* \*/)? = \{.*?\n\t\t\};\n", text, re.S)
    assert match, f"object not found: {uuid}"
    return match.group(0)


def target_uuid(name):
    match = re.search(r"([0-9A-F]{24}) /\* " + re.escape(name) + r" \*/ = \{\n\t\t\tisa = PBXNativeTarget;", text)
    assert match, f"target not found: {name}"
    return match.group(1)


def field(uuid, key):
    match = re.search(key + r" = ([0-9A-F]{24})", block(uuid))
    assert match, f"{key} not found in {uuid}"
    return match.group(1)


def group_uuid(name):
    match = re.search(r"([0-9A-F]{24}) /\* " + re.escape(name) + r" \*/ = \{\n\t\t\tisa = PBXGroup;", text)
    assert match, f"group not found: {name}"
    return match.group(1)


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


# ------------------------------------------------------------ shared sources
# One group and one set of file references, shared by both platforms — the
# share sheet's code is identical on iOS and macOS apart from the hosting shim.
share_group_children = []
share_refs = {}
for filename in SHARE_SOURCES:
    ref = uid()
    share_refs[filename] = ref
    insert_after_section(
        "PBXFileReference",
        f'\t\t{ref} /* {filename} */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; '
        f'name = {filename}; path = "Shared (Share)/{filename}"; sourceTree = "<group>"; }};\n',
    )
    share_group_children.append(f"\t\t\t\t{ref} /* {filename} */,\n")

share_group = uid()
insert_after_section(
    "PBXGroup",
    f"\t\t{share_group} /* Shared (Share) */ = {{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n"
    + "".join(share_group_children)
    + f'\t\t\t);\n\t\t\tname = "Shared (Share)";\n\t\t\tsourceTree = "<group>";\n\t\t}};\n',
)
main_group = re.search(r"mainGroup = ([0-9A-F]{24});", text).group(1)
insert_into(main_group, "children", f"\t\t\t\t{share_group} /* Shared (Share) */,\n", "PBXGroup")

# Core file references already exist from xcode-wire.py; reuse them so the same
# file is not declared twice in one project.
core_refs = {}
for filename in CORE_FILES:
    match = re.search(r"([0-9A-F]{24}) /\* " + re.escape(filename) + r" \*/ = \{isa = PBXFileReference;", text)
    assert match, f"core file reference missing — run scripts/xcode-wire.py first: {filename}"
    core_refs[filename] = match.group(1)

products_group = group_uuid("Products")

for key, host_name, template_name in PLATFORMS:
    host = target_uuid(host_name)
    template = target_uuid(template_name)
    display = f"GlassFrog Clipper Share Extension ({key})"

    # --- build configurations, cloned from the Safari extension's own ---
    config_list = field(template, "buildConfigurationList")
    template_configs = re.findall(r"([0-9A-F]{24}) /\* (Debug|Release) \*/", block(config_list))
    new_configs = []
    for old_uuid, name in template_configs:
        new_uuid = uid()
        body = block(old_uuid)
        body = body.replace(old_uuid, new_uuid, 1)
        body = re.sub(r'INFOPLIST_FILE = "[^"]*";', f'INFOPLIST_FILE = "{key} (Share)/Info.plist";', body)
        body = re.sub(
            r"PRODUCT_BUNDLE_IDENTIFIER = [^;]+;",
            "PRODUCT_BUNDLE_IDENTIFIER = com.integralproductivity.GlassFrogClipper.Share;",
            body,
        )
        body = re.sub(r'PRODUCT_NAME = [^;]+;', 'PRODUCT_NAME = "GlassFrog Clipper Share";', body)
        # The Safari handler links SafariServices; the share sheet has no use
        # for it, and linking a framework a target never calls is a dependency
        # someone later has to reason about.
        body = re.sub(r"\t*OTHER_LDFLAGS = \([^)]*\);\n", "", body)
        insert_after_section("XCBuildConfiguration", body)
        new_configs.append((new_uuid, name))

    new_list = uid()
    insert_after_section(
        "XCConfigurationList",
        f'\t\t{new_list} /* Build configuration list for PBXNativeTarget "{display}" */ = {{\n'
        f"\t\t\tisa = XCConfigurationList;\n\t\t\tbuildConfigurations = (\n"
        + "".join(f"\t\t\t\t{u} /* {n} */,\n" for u, n in new_configs)
        + "\t\t\t);\n\t\t\tdefaultConfigurationIsVisible = 0;\n"
        "\t\t\tdefaultConfigurationName = Release;\n\t\t};\n",
    )

    # --- build phases ---
    sources_phase, frameworks_phase, resources_phase = uid(), uid(), uid()
    source_entries = ""
    for filename in SHARE_SOURCES:
        bf = uid()
        insert_after_section(
            "PBXBuildFile",
            f"\t\t{bf} /* {filename} in Sources */ = {{isa = PBXBuildFile; fileRef = {share_refs[filename]} /* {filename} */; }};\n",
        )
        source_entries += f"\t\t\t\t{bf} /* {filename} in Sources */,\n"
    for filename in CORE_FILES:
        bf = uid()
        insert_after_section(
            "PBXBuildFile",
            f"\t\t{bf} /* {filename} in Sources */ = {{isa = PBXBuildFile; fileRef = {core_refs[filename]} /* {filename} */; }};\n",
        )
        source_entries += f"\t\t\t\t{bf} /* {filename} in Sources */,\n"

    insert_after_section(
        "PBXSourcesBuildPhase",
        f"\t\t{sources_phase} /* Sources */ = {{\n\t\t\tisa = PBXSourcesBuildPhase;\n"
        f"\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n{source_entries}\t\t\t);\n"
        "\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};\n",
    )
    insert_after_section(
        "PBXFrameworksBuildPhase",
        f"\t\t{frameworks_phase} /* Frameworks */ = {{\n\t\t\tisa = PBXFrameworksBuildPhase;\n"
        "\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t);\n"
        "\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};\n",
    )
    insert_after_section(
        "PBXResourcesBuildPhase",
        f"\t\t{resources_phase} /* Resources */ = {{\n\t\t\tisa = PBXResourcesBuildPhase;\n"
        "\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t);\n"
        "\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};\n",
    )

    # --- product, target, and the host app's dependency on it ---
    product = uid()
    insert_after_section(
        "PBXFileReference",
        f'\t\t{product} /* GlassFrog Clipper Share.appex */ = {{isa = PBXFileReference; '
        f"explicitFileType = \"wrapper.app-extension\"; includeInIndex = 0; "
        f'path = "GlassFrog Clipper Share.appex"; sourceTree = BUILT_PRODUCTS_DIR; }};\n',
    )
    insert_into(products_group, "children", f"\t\t\t\t{product} /* GlassFrog Clipper Share.appex */,\n", "PBXGroup")

    target = uid()
    insert_after_section(
        "PBXNativeTarget",
        f"\t\t{target} /* {display} */ = {{\n\t\t\tisa = PBXNativeTarget;\n"
        f'\t\t\tbuildConfigurationList = {new_list} /* Build configuration list for PBXNativeTarget "{display}" */;\n'
        f"\t\t\tbuildPhases = (\n\t\t\t\t{sources_phase} /* Sources */,\n"
        f"\t\t\t\t{frameworks_phase} /* Frameworks */,\n\t\t\t\t{resources_phase} /* Resources */,\n\t\t\t);\n"
        f"\t\t\tbuildRules = (\n\t\t\t);\n\t\t\tdependencies = (\n\t\t\t);\n"
        f'\t\t\tname = "{display}";\n\t\t\tpackageProductDependencies = (\n\t\t\t);\n'
        f'\t\t\tproductName = "{display}";\n'
        f'\t\t\tproductReference = {product} /* GlassFrog Clipper Share.appex */;\n'
        f'\t\t\tproductType = "com.apple.product-type.app-extension";\n\t\t}};\n',
    )

    project_object = re.search(r"([0-9A-F]{24}) /\* Project object \*/", text).group(1)
    proxy, dependency, embed_file = uid(), uid(), uid()
    insert_after_section(
        "PBXContainerItemProxy",
        f"\t\t{proxy} /* PBXContainerItemProxy */ = {{\n\t\t\tisa = PBXContainerItemProxy;\n"
        f"\t\t\tcontainerPortal = {project_object} /* Project object */;\n"
        f"\t\t\tproxyType = 1;\n\t\t\tremoteGlobalIDString = {target};\n"
        f'\t\t\tremoteInfo = "{display}";\n\t\t}};\n',
    )
    insert_after_section(
        "PBXTargetDependency",
        f"\t\t{dependency} /* PBXTargetDependency */ = {{\n\t\t\tisa = PBXTargetDependency;\n"
        f'\t\t\ttarget = {target} /* {display} */;\n'
        f"\t\t\ttargetProxy = {proxy} /* PBXContainerItemProxy */;\n\t\t}};\n",
    )
    insert_into(host, "dependencies", f"\t\t\t\t{dependency} /* PBXTargetDependency */,\n", "PBXNativeTarget")

    # Embedded in the host app, like the Safari extension beside it. Without
    # this the target builds and the share sheet never offers it.
    insert_after_section(
        "PBXBuildFile",
        f"\t\t{embed_file} /* GlassFrog Clipper Share.appex in Embed Foundation Extensions */ = "
        f"{{isa = PBXBuildFile; fileRef = {product} /* GlassFrog Clipper Share.appex */; "
        f"settings = {{ATTRIBUTES = (RemoveHeadersOnCopy, ); }}; }};\n",
    )
    embed_phase = re.search(
        re.escape(host) + r".*?buildPhases = \(.*?([0-9A-F]{24}) /\* Embed Foundation Extensions \*/",
        text,
        re.S,
    ).group(1)
    insert_into(
        embed_phase, "files",
        f"\t\t\t\t{embed_file} /* GlassFrog Clipper Share.appex in Embed Foundation Extensions */,\n",
        "PBXCopyFilesBuildPhase",
    )

    text = re.sub(
        r"(\n\t\t\ttargets = \(\n)",
        lambda m: m.group(1) + f"\t\t\t\t{target} /* {display} */,\n",
        text,
        count=1,
    )
    print(f"added {display}")

PROJECT.write_text(text)
