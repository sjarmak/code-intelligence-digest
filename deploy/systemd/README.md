# Local-primary scheduled jobs (systemd user timers)

Two timers: the daily ingest (`code-intel-daily`) and the audio orphan sweep
(`code-intel-reconcile-audio`).

## Daily ingestion

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

## Audio orphan sweep

Bead `code-intel-digest-b1l`. Audio bytes are written before the
`generated_podcast_audio` row; when that row never lands the file is referenced by
nothing and nothing else collects it. `code-intel-reconcile-audio.timer` runs
`scripts/reconcile-audio-daily.sh` daily at 04:30.

It carries the same `USE_LOCAL_DB=true` preflight as the ingest wrapper, and for a
sharper reason: the sweep deletes local files that no DB row references, so a
driver falling back to `DATABASE_URL` would find the entire local store
unreferenced and delete it.

**It ships dry-run.** The unit sets `RECONCILE_AUDIO_APPLY=false`, so scheduled runs
report `orphaned=` / `reclaimable=` counts without deleting. Read a few days of
`~/.code-intel-digest-logs/reconcile-audio.log`, then promote — editing the repo
copy first and re-deploying from it, so the two cannot drift:

```bash
sed -i 's/RECONCILE_AUDIO_APPLY=false/RECONCILE_AUDIO_APPLY=true/' \
  deploy/systemd/code-intel-reconcile-audio.service
cp deploy/systemd/code-intel-reconcile-audio.service ~/.config/systemd/user/
systemctl --user daemon-reload
```

Promoting only the deployed copy would leave the repo saying `false`, and the next
reinstall (the `cp` sequence below, e.g. on a reprovisioned host) would silently
un-arm a sweep believed to be live. Commit the flip.

Files newer than the 24h grace window are never eligible, so a render in flight is
not at risk.

## Install

```bash
mkdir -p ~/.config/systemd/user
cp deploy/systemd/code-intel-daily.service ~/.config/systemd/user/
cp deploy/systemd/code-intel-daily.timer   ~/.config/systemd/user/
cp deploy/systemd/code-intel-embed.service ~/.config/systemd/user/
cp deploy/systemd/code-intel-reconcile-audio.service ~/.config/systemd/user/
cp deploy/systemd/code-intel-reconcile-audio.timer   ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now code-intel-daily.timer
systemctl --user enable --now code-intel-reconcile-audio.timer
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

systemctl --user list-timers code-intel-reconcile-audio.timer  # next sweep
systemctl --user start code-intel-reconcile-audio.service      # sweep now
tail -f ~/.code-intel-digest-logs/reconcile-audio.log          # sweep results
```

The units hardcode the repo path and `~/.local/bin` (where node/npm/npx live);
adjust both if either moves.
