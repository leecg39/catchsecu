# tables component specification

Target: src/components/services/tables.tsx

- [sms__history source specification](sms__history.spec.md)
- [mail__history source specification](mail__history.spec.md)
- [sms__number source specification](sms__number.spec.md)
- [mail__number source specification](mail__number.spec.md)
- [integration__message source specification](integration__message.spec.md)

Interaction model: click-driven tabs and filters; no scroll-dependent content changes observed.
Original exact computed CSS, DOM hierarchy, dimensions, content, assets and inline SVG are in the corresponding JSON files.
Desktop 1440, tablet 768 and mobile 390 screenshots are in docs/design-references/services/.

Mutating actions use local demo state only. No real messages, payments or registrations are sent.
Yearly pricing and exact hover state remain unverified.
Source-unavailable dynamic routes must be reported as unverified, never complete.
Browser QA is reserved for the parent agent to avoid concurrent tab focus interference.
