# Local-primary daily ingestion (systemd user timer)

Replaces the Render cron for the local-primary migration (bead `code-intel-digest-06d` / P2.1).
The timer runs `scripts/run-local-cron.sh`, which forces the driver onto
`LOCAL_DATABASE_URL` (`USE_LOCAL_DB=true`) and refuses to run unless that URL is a
local postgres host — so the scheduled job can never write the Render prod DB.

After each ingest, `code-intel-daily.service` pulls in `code-intel-embed.service`
(bead `code-intel-digest-i4t.3`) via `Wants=`, ordered `After=` it. That unit runs
`scripts/run-local-embed.sh`, which embeds items missing a normalized nomic (768d)
row in `item_model_embeddings` so new arrivals reach the HNSW/nomic serve path.
There is **no embed timer** — it fires on the ingest's completion, not a wall-clock
offset, so it never races a long-running sync.

## Install

```bash
mkdir -p ~/.config/systemd/user
cp deploy/systemd/code-intel-daily.service ~/.config/systemd/user/
cp deploy/systemd/code-intel-daily.timer   ~/.config/systemd/user/
cp deploy/systemd/code-intel-embed.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now code-intel-daily.timer
```

`code-intel-embed.service` is **not** enabled directly (it has no `[Install]`
section): the daily unit's `Wants=` activates it. Enabling it standalone would
start it once at boot, which is not the intent.

(Linger must be on so it fires without a login session: `loginctl enable-linger $USER`.)

## Operate

```bash
systemctl --user list-timers code-intel-daily.timer   # next run
systemctl --user start code-intel-daily.service       # run now (sync, then embed)
journalctl --user -u code-intel-daily.service -f      # ingest logs
systemctl --user start code-intel-embed.service       # embed missing items now (no sync)
journalctl --user -u code-intel-embed.service -f      # embed logs
systemctl --user disable --now code-intel-daily.timer # stop scheduling
```

The units hardcode the repo path and `~/.local/bin` (where node/npm/npx live);
adjust both if either moves.
