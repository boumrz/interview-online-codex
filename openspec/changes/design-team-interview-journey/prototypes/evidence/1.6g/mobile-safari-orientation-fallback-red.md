# Mobile Safari orientation fallback — focused RED

Initial core-behaviour command, executed before the fallback helper was connected to the prototype:

```sh
node openspec/changes/design-team-interview-journey/prototypes/evidence/1.6g/mobile-safari-orientation-fallback-check.mjs
```

Expected pre-fix failure:

```json
{"pass":false,"direct":"0/6","rotate":"0/6","otherBrowser":true,"pageErrors":0}
```

Exit code: `1`. The failure was caused by the missing iPhone Safari landscape focus interception and orientation fallback on all DA-01–DA-06 representative surfaces. The non-Safari negative control already passed.

The test was strengthened after GREEN with 44 px geometry, safe-area, screenshots and room-navigation checks, so its current filesystem mtime is newer than the HTML includes. Because the first JSON was overwritten by a GREEN run, the exact strengthened test was also replayed against a temporary copy of the current prototype with only the four `mobile-input-fallback.js` includes removed:

```sh
PROTOTYPE_URL=http://127.0.0.1:4176/ \
FALLBACK_ARTIFACT_PREFIX=pre-fallback-red \
FALLBACK_REPORT_NAME=mobile-safari-orientation-fallback-pre-fallback-red-report.json \
node openspec/changes/design-team-interview-journey/prototypes/evidence/1.6g/mobile-safari-orientation-fallback-check.mjs
```

That behavior-specific replay also exited `1` with the same result:

```json
{"pass":false,"direct":"0/6","rotate":"0/6","otherBrowser":true,"pageErrors":0}
```

The preserved detailed result is `mobile-safari-orientation-fallback-pre-fallback-red-report.json`. This replay demonstrates the pre-helper behavior but does not rewrite the chronology: the stronger geometry assertions were added after the first GREEN.

The first attempted run used an invalid `/personal/profile` fixture and timed out before exercising product behavior. The route was corrected to the prototype's authoritative `/profile` entry before the RED result above was recorded.
