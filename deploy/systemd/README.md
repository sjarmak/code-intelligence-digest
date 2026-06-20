# Local-primary daily ingestion (systemd user timer)

Replaces the Render cron for the local-primary migration (bead `code-intel-digest-06d` / P2.1).
The timer runs `scripts/run-local-cron.sh`, which forces the driver onto
`LOCAL_DATABASE_URL` (`USE_LOCAL_DB=true`) and refuses to run unless that URL is a
local postgres host — so the scheduled job can never write the Render prod DB.

## Install

```bash
mkdir -p ~/.config/systemd/user
cp deploy/systemd/code-intel-daily.service ~/.config/systemd/user/
cp deploy/systemd/code-intel-daily.timer   ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now code-intel-daily.timer
```

(Linger must be on so it fires without a login session: `loginctl enable-linger $USER`.)

## Operate

```bash
systemctl --user list-timers code-intel-daily.timer   # next run
systemctl --user start code-intel-daily.service       # run now (real sync)
journalctl --user -u code-intel-daily.service -f      # logs
systemctl --user disable --now code-intel-daily.timer # stop scheduling
```

The units hardcode the repo path and `~/.local/bin` (where node/npm/npx live);
adjust both if either moves.
