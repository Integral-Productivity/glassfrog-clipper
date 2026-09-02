/**
 * A fresh fake Chrome per scenario, torn down after.
 *
 * `src/storage.ts` reaches for `chrome.storage.local` lazily on every call
 * rather than capturing it at module load, so installing the fake here — after
 * the modules are imported — is enough. A scenario that leaked storage into the
 * next one would make ordering significant, and an order-dependent suite tells
 * you nothing on the run where it happens to pass.
 */
import { After, Before } from '@cucumber/cucumber';

import { ClipperWorld } from './world.ts';

Before(function (this: ClipperWorld) {
  this.installChrome();
  this.filed = [];
  this.events = [];
  this.draft = {};
  this.outcome = { state: 'none' };
  this.writeFailure = undefined;
});

After(function (this: ClipperWorld) {
  this.teardown();
});
