// Cucumber-js configuration.
//
// Step definitions are TypeScript and are loaded with NO transpiler: Node
// strips types natively from 22.18 onward, which `.nvmrc` already pins as the
// floor for `node --test` to discover `.ts` files at all. devops-excellence
// runs cucumber under `--import tsx` because it predates that; adding tsx here
// would be a second devDependency doing what the runtime already does, on a
// repo whose Distribution track is about being cheap to audit.
//
// Profiles:
//   default — used by `npm run bdd`. Runs every .feature under features/.
//   wip     — runs only @wip-tagged scenarios, non-strict, while one is being
//             written. Never what CI runs.

module.exports = {
  default: {
    paths: ['features/**/*.feature'],
    import: ['features/**/*.ts'],
    format: ['progress-bar', 'summary'],
    // Undefined and pending steps fail the run. Without this a scenario whose
    // steps were never implemented reports as a pass, which is the exact
    // failure mode `BDD / Scenarios` is a required check to prevent.
    strict: true,
  },
  wip: {
    paths: ['features/**/*.feature'],
    import: ['features/**/*.ts'],
    tags: '@wip',
    format: ['progress-bar', 'summary'],
    strict: false,
  },
};
