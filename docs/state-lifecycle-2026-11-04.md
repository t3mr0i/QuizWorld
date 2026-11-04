# State lifecycle repair, 4 November 2026

Guard authoritative quiz round transitions.

Scope: `t3mr0i/QuizWorld` at `40e973ad8ccd8cfeb0bf2b183195e3d600b36166`. Kai requested an audit and fixes for apps updated 21 October–4 November 2026.

- Duplicate joins retain host, answer and score.
- Start and next commands obey waiting/results phases; current clients attach the expected question index.
- Departure of the last unanswered player settles the round; empty rooms drop their stale session.
- Answer indices and readiness types are validated before consuming a slot.

Verification: 5 server regressions fail before and pass after. Expected question indices remain optional for legacy clients; this does not establish durable server recovery or live deployment.

Integration: isolated review branch; no deployment is asserted. The inventory is a static map of overlapping lifecycles, not proof that every possible transition was reviewed.
