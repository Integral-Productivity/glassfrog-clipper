# The Chrome surface layer.
#
# WHAT THIS PROVES, PRECISELY: that the assumptions this extension encodes
# about Chrome's contract still hold in the code. It runs offline in Node
# against `test/support/chrome.ts` — a fake we wrote — so it cannot observe
# Chrome's actual behaviour and must never be read as evidence the extension
# works in a browser. `src/glassfrog.ts` carries a `fetch.bind(globalThis)`
# whose comment records a bug that fails ONLY in Chrome and passes everywhere
# else; nothing in this file could have caught it.
#
# What catches real Chrome is docs/verifying-in-chrome.md, by hand.
# What this file catches is those encoded assumptions drifting silently — a
# refactor that starts awaiting the network before reading the selection reads
# perfectly well and breaks capture on every navigation.
#
# See docs/adr/0011 for the two-layer split and this boundary.

Feature: Reading a page through Chrome's extension surface

  Background:
    Given the capture role is configured

  # KTD6. activeTab is revoked on cross-origin navigation, so a read deferred
  # past a network await returns nothing on exactly the pages worth clipping.
  Scenario: The selection is read on the invoking gesture, before any network call
    Given the page has the selection "governance is where this belongs"
    When the practitioner triggers a quick capture
    Then the selection was read before anything was sent to GlassFrog
    And the detail contains "governance is where this belongs"

  # OQ7. A page may forbid injection outright. The URL and the title are still
  # worth filing, so this is not a capture failure.
  Scenario: A page that forbids injection still files what the browser knows
    Given the page forbids script injection
    When the practitioner triggers a quick capture
    Then one item is filed
    And the detail contains the page address

  # chrome:// pages and the Web Store deny activeTab outright, so the URL never
  # arrives. Filing an empty tension would be worse than reporting nothing.
  Scenario: A tab the extension cannot read yields no capture at all
    Given the active tab cannot be read
    When the practitioner triggers a quick capture
    Then nothing is filed
    And no pending capture remains

  # Bounded at capture, not only at compose: an unbounded selection would blow
  # the storage quota on its way into the pending slot, losing exactly the
  # capture that slot exists to protect.
  Scenario: An enormous selection is bounded before it reaches storage
    Given the page has a selection of 100000 characters
    When the practitioner triggers a quick capture
    Then one item is filed
    And the filed evidence is bounded to 4000 characters per page field
