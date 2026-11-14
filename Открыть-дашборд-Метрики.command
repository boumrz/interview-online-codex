#!/bin/zsh
cd "${0:A:h}" || exit 1
dashboard_url="http://127.0.0.1:${METRIKA_DASHBOARD_PORT:-4175}/"
if /usr/bin/curl --noproxy '*' --silent --max-time 2 --dump-header - --output /dev/null "$dashboard_url" | /usr/bin/grep -qi '^X-InterHub-Dashboard: metrika'; then
  /usr/bin/open "$dashboard_url"
  exit $?
fi
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
exec node scripts/serve-metrika-dashboard.mjs --open
