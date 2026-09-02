# The domain layer — see docs/adr/0011.

Feature: Never losing a capture

  "Never discard" has to hold in the two places a capture can vanish: before it
  can be filed at all, and after a write goes out whose result nobody saw.

  Rule: A capture made before configuration waits rather than failing

    Scenario: With no capture role, the capture is held rather than dropped
      Given no capture role is configured
      When the practitioner clips the page "Vendor contract is ambiguous"
      Then nothing is filed
      And the capture is held as a pending capture

    Scenario: Saving configuration files what was waiting
      Given no capture role is configured
      And the practitioner has clipped the page "Vendor contract is ambiguous"
      When the capture role is configured and the held capture is retried
      Then one item is filed
      And the headline ends with "Vendor contract is ambiguous"
      And no pending capture remains

    # At most one is ever held. Believing two things were captured and finding
    # one is worse than being told plainly that the first was replaced.
    Scenario: A second capture replaces the first, and says so
      Given no capture role is configured
      And the practitioner has clipped the page "Vendor contract is ambiguous"
      When the practitioner clips the page "Retro format"
      Then the practitioner is told the earlier capture was replaced
      And the held capture is "Retro format"

    # Expiry is what keeps the pending slot from becoming the backlog this
    # product deliberately does not have.
    Scenario: A pending capture expires rather than waiting forever
      Given a pending capture was made 8 days ago
      When the extension reviews what it is holding
      Then no pending capture remains

  Rule: A capture is filed at most once

    # R19 / KTD7. GlassFrog v5 has no idempotency key, so an automatic retry
    # can silently duplicate — and a duplicate on the capture role corrupts the
    # triage-survival metric that ADR 0004 exists to make computable.
    Scenario: An accepted write leaves nothing outstanding
      Given the capture role is configured
      When the practitioner clips the page "Weekly review keeps slipping"
      Then one item is filed
      And nothing is left outstanding

    Scenario: A write whose result was never seen is surfaced, not retried
      Given the capture role is configured
      And the GlassFrog write never returns
      When the practitioner clips the page "Weekly review keeps slipping"
      Then one capture is left outstanding
      And nothing is filed
