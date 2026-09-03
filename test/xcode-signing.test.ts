import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * A fitness function for the signing wiring, in the shape branch-protection and
 * safari-manifest already use: read the artifact, assert the invariant.
 *
 * It exists because the failure it guards is silent in every other surface.
 * `plutil -lint` at the end of xcode-bootstrap.sh validates plist syntax, not
 * that anything was wired. verify-apple.sh passes CODE_SIGNING_ALLOWED=NO on the
 * command line, which outranks the xcconfig, so it can never observe
 * DEVELOPMENT_TEAM either way. And CI never runs the bootstrap at all. A change
 * that dropped the signing wiring would go green through all three, and the App
 * Group and shared Keychain would quietly stop resolving in a shipped build.
 *
 * These assertions need no Xcode and no Apple account, so they run on the same
 * ubuntu job as everything else — the point being that this is maintained by a
 * check rather than by remembering to.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PBXPROJ = join(root, 'apple/GlassFrog Clipper/GlassFrog Clipper.xcodeproj/project.pbxproj');
const XCCONFIG = join(root, 'apple/GlassFrog Clipper/Configurations/Signing.xcconfig');
const BOOTSTRAP = join(root, 'scripts/xcode-bootstrap.sh');

/** The two project-level build configurations, resolved the way the generator does. */
async function projectLevelConfigs(pbxproj: string): Promise<string[]> {
  const project = pbxproj.match(/[0-9A-F]{24} \/\* Project object \*\/ = \{\n\t\t\tisa = PBXProject;[\s\S]*?\n\t\t\};/);
  assert.ok(project, 'PBXProject object not found');
  const listId = project[0].match(/buildConfigurationList = ([0-9A-F]{24})/);
  assert.ok(listId, 'project buildConfigurationList not found');
  const list = pbxproj.match(
    new RegExp(`${listId[1]}(?: \\/\\* [^*]* \\*\\/)? = \\{\\n\\t\\t\\tisa = XCConfigurationList;[\\s\\S]*?\\n\\t\\t\\};`),
  );
  assert.ok(list, 'project XCConfigurationList not found');
  return [...list[0].matchAll(/([0-9A-F]{24}) \/\* (?:Debug|Release) \*\//g)]
    .map((m) => m[1])
    .filter((id): id is string => id !== undefined);
}

test('the generator that reattaches signing still runs on bootstrap', async () => {
  const sh = await readFile(BOOTSTRAP, 'utf8');
  const team = sh.indexOf('xcode-team.py');
  const entitlements = sh.indexOf('xcode-entitlements.py');
  const resources = sh.indexOf('xcode-resource-phase.py');

  assert.ok(team > -1, 'xcode-bootstrap.sh no longer runs xcode-team.py — regeneration would drop the signing team');
  assert.ok(team > entitlements, 'xcode-team.py must run after xcode-entitlements.py');
  assert.ok(team < resources, 'xcode-team.py must run before xcode-resource-phase.py');

  // Without this the project is regenerated and the xcconfig is deleted with it.
  assert.match(sh, /for dir in .*"Configurations"; do/, 'bootstrap must stash Configurations/ across its rm -rf');
});

test('both project-level configurations point at the signing xcconfig', async () => {
  const pbxproj = await readFile(PBXPROJ, 'utf8');
  const configs = await projectLevelConfigs(pbxproj);

  assert.equal(configs.length, 2, 'expected exactly Debug and Release at project level');

  for (const uuid of configs) {
    const block = pbxproj.match(new RegExp(`${uuid}(?: \\/\\* [^*]* \\*\\/)? = \\{\\n\\t\\t\\tisa = XCBuildConfiguration;[\\s\\S]*?\\n\\t\\t\\};`));
    assert.ok(block, `build configuration ${uuid} not found`);
    assert.match(
      block[0],
      /baseConfigurationReference = [0-9A-F]{24} \/\* Signing\.xcconfig \*\//,
      'a project-level configuration lost its Signing.xcconfig reference',
    );
  }
});

test('no target shadows the inherited signing team', async () => {
  const pbxproj = await readFile(PBXPROJ, 'utf8');
  const projectConfigs = new Set(await projectLevelConfigs(pbxproj));

  // The whole design rests on one project-level value reaching all six targets.
  // A target-level DEVELOPMENT_TEAM would silently win over it.
  assert.equal(
    pbxproj.includes('DEVELOPMENT_TEAM'),
    false,
    'a target now sets DEVELOPMENT_TEAM directly — the identifier belongs in the gitignored Local.xcconfig',
  );

  for (const match of pbxproj.matchAll(/([0-9A-F]{24})(?: \/\* (?:Debug|Release) \*\/)? = \{\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbaseConfigurationReference/g)) {
    const uuid = match[1];
    assert.ok(
      uuid !== undefined && projectConfigs.has(uuid),
      `target-level configuration ${uuid} has its own base configuration, shadowing the project's`,
    );
  }
});

test('the signing xcconfig carries no identifier and tolerates its absence', async () => {
  const xcconfig = await readFile(XCCONFIG, 'utf8');

  // The `?` is what keeps an account-less machine — CI included — building.
  assert.match(xcconfig, /#include\?\s+"Local\.xcconfig"/, 'the optional include is what lets a machine with no team build unsigned');
  assert.equal(
    /^\s*DEVELOPMENT_TEAM\s*=/m.test(xcconfig),
    false,
    'the team identifier belongs in the gitignored Local.xcconfig, not in this tracked file',
  );
});
