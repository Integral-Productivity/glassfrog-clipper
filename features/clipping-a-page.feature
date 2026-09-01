# The domain layer. Nothing here names a browser, a popup, a keystroke, or a
# share sheet — see docs/adr/0011 for why, and features/surface/ for where
# platform-shaped behaviour goes instead.

Feature: Clipping a page into GlassFrog

  A Holacracy practitioner senses something mid-task and needs it in GlassFrog
  without leaving the work that produced it. Capture never blocks on a decision
  it could defer, and never discards one the practitioner already made.

  Background:
    Given the capture role is configured

  # R4 / KD2: an unset work type is a tension, so the path that asks for
  # nothing still produces something GlassFrog can hold.
  Scenario: A capture that decides nothing files as a tension
    When the practitioner clips the page "Weekly review keeps slipping"
    Then one item is filed
    And it is filed as a tension
    And it is filed against the capture role

  # R11: without the marker, triage survival is uncomputable — a clipped item
  # becomes indistinguishable from one typed into GlassFrog by hand.
  Scenario: Every filed item is recognisable as clipped
    When the practitioner clips the page "Weekly review keeps slipping"
    Then the headline carries the provenance marker
    And the headline ends with "Weekly review keeps slipping"

  Scenario Outline: A decided work type is honoured, not overridden
    When the practitioner clips the page "Onboarding has no owner" and chooses <work type>
    Then one item is filed
    And it is filed as a <work type>

    Examples:
      | work type |
      | tension   |
      | action    |
      | project   |

  # R5: a role the practitioner named is used as given. Silently replacing it
  # with the configured one would discard a decision already made, which is the
  # half of the promise that is not about speed.
  Scenario: A capture that names its own role is filed there
    When the practitioner clips the page "Budget question" naming a different role
    Then it is filed against the named role
    And it is not filed against the capture role

  # The practitioner is reading their own words in triage, not the URL.
  Scenario: The practitioner's note leads the evidence
    When the practitioner clips the page "Retro format" with the note "this keeps producing the same three items"
    Then the detail begins with "this keeps producing the same three items"
    And the detail contains the page address

  Scenario: Selected text is filed as evidence
    When the practitioner clips the page "Policy draft" having selected "circle leads may not hold the role they assign"
    Then the detail contains "circle leads may not hold the role they assign"

  # ADR 0004: the marker leads its field and is never truncated, so nothing the
  # practitioner captured can displace it. A title long enough to consume the
  # whole headline budget is the case that proves it.
  Scenario: A very long title cannot displace the provenance marker
    When the practitioner clips a page whose title is 5000 characters long
    Then the headline carries the provenance marker
    And the headline is at most 200 characters

  # Truncation must never reach `link` — it is the one field GlassFrog renders
  # the project as linked from.
  Scenario: A project carries the page as a link as well as evidence
    When the practitioner clips the page "Rework the handbook" and chooses project
    Then the project links to the page
    And the detail contains the page address
