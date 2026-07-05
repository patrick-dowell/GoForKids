# 9×9 bot-battle log — §3 campaign (S38–S42, 2026-07-04/05)

Every bot-vs-bot game played during the calibration campaign, verbatim,
in chronological order. Format: `winner+margin (seconds)`. Board 9×9,
weaker side Black unless noted. Config context per section; full knob
history in data/profiles/9x9_profile_archive.yaml + DEVJOURNAL S38-S42.

## Run 1 — iter-1 ladder check (2026-07-04 night)
Configs: 15k = machinery + myopic-local (visits 16, clarity .87/15); 9k = same shape (clarity .80/10); 6k = machinery mistake_freq .65; 30k/3k anchors. All LOCAL (JSON path — device had the parser bug throughout).
```
ladder check start 01:35:56
  15k v 9k game 1: black+71.5 (24s)
  15k v 9k game 2: white+35.5 (17s)
  15k v 9k game 3: white+24.5 (30s)
  15k v 9k game 4: white+53.5 (15s)
  15k v 9k game 5: white+31.5 (20s)
  15k v 9k game 6: white+5.5 (11s)
  15k v 9k game 7: white+38.5 (14s)
  15k v 9k game 8: black+10.5 (18s)
== 15k v 9k: stronger side (W) 6/8 avg W-margin +13.4
  30k v 15k game 1: white+88.5 (7s)
  30k v 15k game 2: white+89.5 (12s)
  30k v 15k game 3: white+88.5 (10s)
  30k v 15k game 4: white+88.5 (7s)
  30k v 15k game 5: white+88.5 (10s)
  30k v 15k game 6: white+88.5 (12s)
  30k v 15k game 7: white+88.5 (9s)
  30k v 15k game 8: white+89.5 (13s)
== 30k v 15k: stronger side (W) 8/8 avg W-margin +88.8
  9k v 6k game 1: white+50.5 (12s)
  9k v 6k game 2: white+26.5 (16s)
  9k v 6k game 3: white+7.5 (23s)
  9k v 6k game 4: white+25.5 (24s)
  9k v 6k game 5: black+22.5 (21s)
  9k v 6k game 6: white+27.5 (22s)
  9k v 6k game 7: white+15.5 (26s)
  9k v 6k game 8: white+1.5 (16s)
== 9k v 6k: stronger side (W) 7/8 avg W-margin +16.5
  6k v 3k game 1: white+5.5 (36s)
  6k v 3k game 2: black+47.5 (19s)
  6k v 3k game 3: black+41.5 (27s)
  6k v 3k game 4: white+1.5 (14s)
  6k v 3k game 5: black+4.5 (12s)
  6k v 3k game 6: white+17.5 (10s)
  6k v 3k game 7: white+3.5 (17s)
  6k v 3k game 8: white+12.5 (21s)
== 6k v 3k: stronger side (W) 5/8 avg W-margin -6.6

==== SUMMARY ====
15k v 9k: stronger side (W) 6/8 avg W-margin +13.4
30k v 15k: stronger side (W) 8/8 avg W-margin +88.8
9k v 6k: stronger side (W) 7/8 avg W-margin +16.5
6k v 3k: stronger side (W) 5/8 avg W-margin -6.6
```
## Run 2 — iter-2 sigma noise (σ 6/4.5)
15k/9k switched to score_noise argmax (σ6/σ4.5).
```
ladder check start 01:59:28
  15k v 9k game 1: black+44.5 (20s)
  15k v 9k game 2: white+32.5 (19s)
  15k v 9k game 3: black+3.5 (15s)
  15k v 9k game 4: white+43.5 (20s)
  15k v 9k game 5: black+0.5 (10s)
  15k v 9k game 6: white+7.5 (12s)
  15k v 9k game 7: black+30.5 (21s)
  15k v 9k game 8: white+23.5 (13s)
== 15k v 9k: stronger side (W) 4/8 avg W-margin +3.5
  30k v 15k game 1: white+88.5 (9s)
  30k v 15k game 2: white+88.5 (10s)
  30k v 15k game 3: white+88.5 (12s)
  30k v 15k game 4: white+46.5 (10s)
  30k v 15k game 5: white+89.5 (11s)
  30k v 15k game 6: white+88.5 (10s)
  30k v 15k game 7: white+88.5 (10s)
  30k v 15k game 8: white+88.5 (7s)
== 30k v 15k: stronger side (W) 8/8 avg W-margin +83.4
  9k v 6k game 1: black+72.5 (9s)
  9k v 6k game 2: white+4.5 (12s)
  9k v 6k game 3: black+4.5 (19s)
  9k v 6k game 4: black+33.5 (19s)
  9k v 6k game 5: black+7.5 (13s)
  9k v 6k game 6: black+40.5 (13s)
  9k v 6k game 7: black+0.5 (14s)
  9k v 6k game 8: black+1.5 (16s)
== 9k v 6k: stronger side (W) 1/8 avg W-margin -19.5
  6k v 3k game 1: white+32.5 (20s)
  6k v 3k game 2: white+31.5 (19s)
  6k v 3k game 3: black+5.5 (14s)
  6k v 3k game 4: white+22.5 (29s)
  6k v 3k game 5: white+25.5 (17s)
  6k v 3k game 6: white+17.5 (22s)
  6k v 3k game 7: white+44.5 (12s)
  6k v 3k game 8: white+15.5 (27s)
== 6k v 3k: stronger side (W) 7/8 avg W-margin +23.0

==== SUMMARY ====
15k v 9k: stronger side (W) 4/8 avg W-margin +3.5
30k v 15k: stronger side (W) 8/8 avg W-margin +83.4
9k v 6k: stronger side (W) 1/8 avg W-margin -19.5
6k v 3k: stronger side (W) 7/8 avg W-margin +23.0
```
## Run 3 — iter-2b sigma doubled (σ 12/7)
```
ladder check start 02:10:21
  15k v 9k game 1: white+88.5 (21s)
  15k v 9k game 2: white+3.5 (13s)
  15k v 9k game 3: black+13.5 (18s)
  15k v 9k game 4: black+28.5 (20s)
  15k v 9k game 5: black+12.5 (11s)
  15k v 9k game 6: white+33.5 (22s)
  15k v 9k game 7: black+12.5 (20s)
  15k v 9k game 8: white+0.5 (16s)
== 15k v 9k: stronger side (W) 4/8 avg W-margin +7.4
  30k v 15k game 1: white+88.5 (9s)
  30k v 15k game 2: white+88.5 (10s)
  30k v 15k game 3: white+89.5 (12s)
  30k v 15k game 4: white+88.5 (13s)
  30k v 15k game 5: white+89.5 (12s)
  30k v 15k game 6: white+88.5 (13s)
  30k v 15k game 7: white+88.5 (9s)
  30k v 15k game 8: white+89.5 (10s)
== 30k v 15k: stronger side (W) 8/8 avg W-margin +88.9
  9k v 6k game 1: black+14.5 (18s)
  9k v 6k game 2: black+72.5 (22s)
  9k v 6k game 3: white+14.5 (23s)
  9k v 6k game 4: white+38.5 (27s)
  9k v 6k game 5: black+4.5 (22s)
  9k v 6k game 6: black+23.5 (21s)
  9k v 6k game 7: black+5.5 (16s)
  9k v 6k game 8: black+1.5 (8s)
== 9k v 6k: stronger side (W) 2/8 avg W-margin -8.6
  6k v 3k game 1: black+27.5 (24s)
  6k v 3k game 2: white+3.5 (973s)
  6k v 3k game 3: white+8.5 (10s)
  6k v 3k game 4: black+30.5 (18s)
  6k v 3k game 5: white+7.5 (986s)
  6k v 3k game 6: white+28.5 (16s)
  6k v 3k game 7: white+26.5 (15s)
  6k v 3k game 8: white+25.5 (13s)
== 6k v 3k: stronger side (W) 6/8 avg W-margin +5.2

==== SUMMARY ====
15k v 9k: stronger side (W) 4/8 avg W-margin +7.4
30k v 15k: stronger side (W) 8/8 avg W-margin +88.9
9k v 6k: stronger side (W) 2/8 avg W-margin -8.6
6k v 3k: stronger side (W) 6/8 avg W-margin +5.2
```
## Run 4 — iter-2c (9k reverted to iter-1; 15k random-nearby local)
```
ladder check start 12:42:36
  15k v 9k game 1: white+88.5 (12s)
  15k v 9k game 2: white+88.5 (13s)
  15k v 9k game 3: white+58.5 (18s)
  15k v 9k game 4: white+88.5 (16s)
  15k v 9k game 5: white+88.5 (20s)
  15k v 9k game 6: white+89.5 (17s)
  15k v 9k game 7: white+88.5 (9s)
  15k v 9k game 8: white+88.5 (7s)
== 15k v 9k: stronger side (W) 8/8 avg W-margin +84.9
  30k v 15k game 1: white+89.5 (13s)
  30k v 15k game 2: white+88.5 (11s)
  30k v 15k game 3: white+56.5 (16s)
  30k v 15k game 4: white+88.5 (9s)
  30k v 15k game 5: white+88.5 (18s)
  30k v 15k game 6: white+89.5 (9s)
  30k v 15k game 7: white+88.5 (11s)
  30k v 15k game 8: white+88.5 (9s)
== 30k v 15k: stronger side (W) 8/8 avg W-margin +84.8
  9k v 6k game 1: white+5.5 (9s)
  9k v 6k game 2: white+19.5 (11s)
  9k v 6k game 3: black+31.5 (10s)
  9k v 6k game 4: black+73.5 (18s)
  9k v 6k game 5: white+26.5 (11s)
  9k v 6k game 6: white+39.5 (13s)
  9k v 6k game 7: black+30.5 (10s)
  9k v 6k game 8: black+35.5 (9s)
== 9k v 6k: stronger side (W) 4/8 avg W-margin -10.0
  6k v 3k game 1: black+73.5 (18s)
  6k v 3k game 2: black+20.5 (18s)
  6k v 3k game 3: black+53.5 (19s)
  6k v 3k game 4: white+38.5 (15s)
  6k v 3k game 5: white+26.5 (13s)
  6k v 3k game 6: black+20.5 (13s)
  6k v 3k game 7: white+4.5 (13s)
  6k v 3k game 8: black+0.5 (21s)
== 6k v 3k: stronger side (W) 3/8 avg W-margin -12.4

==== SUMMARY ====
15k v 9k: stronger side (W) 8/8 avg W-margin +84.9
30k v 15k: stronger side (W) 8/8 avg W-margin +84.8
9k v 6k: stronger side (W) 4/8 avg W-margin -10.0
6k v 3k: stronger side (W) 3/8 avg W-margin -12.4
```
## Run 5 — iter-2d final n=10 (myopic dropped from both)
```
ladder check start 12:51:28
  15k v 9k game 1: white+50.5 (30s)
  15k v 9k game 2: white+2.5 (14s)
  15k v 9k game 3: black+72.5 (13s)
  15k v 9k game 4: white+88.5 (18s)
  15k v 9k game 5: white+54.5 (20s)
  15k v 9k game 6: white+88.5 (12s)
  15k v 9k game 7: white+88.5 (7s)
  15k v 9k game 8: white+18.5 (17s)
  15k v 9k game 9: white+88.5 (15s)
  15k v 9k game 10: black+4.5 (21s)
== 15k v 9k: stronger side (W) 8/10 avg W-margin +40.3
  9k v 6k game 1: white+71.5 (14s)
  9k v 6k game 2: white+88.5 (8s)
  9k v 6k game 3: white+88.5 (9s)
  9k v 6k game 4: white+49.5 (14s)
  9k v 6k game 5: white+88.5 (14s)
  9k v 6k game 6: white+88.5 (10s)
  9k v 6k game 7: white+96.5 (26s)
  9k v 6k game 8: white+88.5 (15s)
  9k v 6k game 9: white+88.5 (16s)
  9k v 6k game 10: white+88.5 (16s)
== 9k v 6k: stronger side (W) 10/10 avg W-margin +83.7

==== SUMMARY ====
15k v 9k: stronger side (W) 8/10 avg W-margin +40.3
9k v 6k: stronger side (W) 10/10 avg W-margin +83.7
```
## Run 6 — iter-3b sweep vs fixed 6k (reading_rate/policy_temp variants)
Variant A: rr.15/t2.2 · B: rr.10/t2.6 · C: rr.20/t1.9. Target: 6k wins by +40..50 (Patrick-2d anchor).
```

### variant A: {'reading_rate': 0.15, 'policy_temp': 2.2, 'wide_root_noise': 0.6}
    A: 15k v 6k game 1: W-1.5 (15s)
    A: 15k v 6k game 2: W+6.5 (12s)
    A: 15k v 6k game 3: W+88.5 (18s)
    A: 15k v 6k game 4: W+88.5 (17s)
    A: 15k v 6k game 5: W+51.5 (12s)
    A: 15k v 6k game 6: W+46.5 (15s)
  == A: 15k v 6k: W wins 5/6, avg W-margin +46.7

### variant B: {'reading_rate': 0.1, 'policy_temp': 2.6, 'wide_root_noise': 0.7}


### variant B: {'reading_rate': 0.1, 'policy_temp': 2.6, 'wide_root_noise': 0.7}
    B: 15k v 6k game 1: W+44.5 (28s)
    B: 15k v 6k game 2: W+54.5 (24s)
    B: 15k v 6k game 3: W+88.5 (20s)
    B: 15k v 6k game 4: W+59.5 (23s)
    B: 15k v 6k game 5: W+62.5 (14s)
    B: 15k v 6k game 6: W+31.5 (18s)
  == B: 15k v 6k: W wins 6/6, avg W-margin +56.8

### variant C: {'reading_rate': 0.2, 'policy_temp': 1.9, 'wide_root_noise': 0.6}
    C: 15k v 6k game 1: W+88.5 (21s)
    C: 15k v 6k game 2: W+31.5 (19s)
    C: 15k v 6k game 3: W-0.5 (20s)
    C: 15k v 6k game 4: W-8.5 (13s)
    C: 15k v 6k game 5: W+88.5 (24s)
    C: 15k v 6k game 6: W-29.5 (22s)
  == C: 15k v 6k: W wins 3/6, avg W-margin +28.3

### variant A2: {'reading_rate': 0.15, 'policy_temp': 2.2, 'wide_root_noise': 0.6}
    A2: 15k v 6k game 1: W+51.5 (24s)
    A2: 15k v 6k game 2: W+47.5 (21s)
    A2: 15k v 6k game 3: W+42.5 (18s)
    A2: 15k v 6k game 4: W+67.5 (19s)
    A2: 15k v 6k game 5: W+46.5 (27s)
    A2: 15k v 6k game 6: W+49.5 (20s)
  == A2: 15k v 6k: W wins 6/6, avg W-margin +50.8

==== SWEEP SUMMARY (target: +40..+50) ====
variant B: 6k margin +56.8
variant C: 6k margin +28.3
variant A2: 6k margin +50.8
```
## Run 7 — iter-3 separation check (reading_rate mechanism live)
15k = rr.30/t1.4/wrn.6 · 9k = rr.55/t1.15/wrn.45.
```
ladder check start 13:06:26
  15k v 9k game 1: white+38.5 (21s)
  15k v 9k game 2: white+3.5 (22s)
  15k v 9k game 3: black+73.5 (20s)
  15k v 9k game 4: white+8.5 (21s)
  15k v 9k game 5: black+18.5 (17s)
  15k v 9k game 6: white+2.5 (20s)
  15k v 9k game 7: white+25.5 (19s)
  15k v 9k game 8: white+15.5 (18s)
  15k v 9k game 9: black+2.5 (12s)
  15k v 9k game 10: white+6.5 (11s)
== 15k v 9k: stronger side (W) 7/10 avg W-margin +0.6
  9k v 6k game 1: black+18.5 (13s)
  9k v 6k game 2: white+5.5 (13s)
  9k v 6k game 3: white+48.5 (17s)
  9k v 6k game 4: white+0.5 (22s)
  9k v 6k game 5: white+5.5 (11s)
  9k v 6k game 6: white+39.5 (16s)
  9k v 6k game 7: white+41.5 (12s)
  9k v 6k game 8: white+45.5 (17s)
  9k v 6k game 9: white+19.5 (25s)
  9k v 6k game 10: white+6.5 (12s)
== 9k v 6k: stronger side (W) 9/10 avg W-margin +19.4
  30k v 15k game 1: white+88.5 (10s)
  30k v 15k game 2: white+90.5 (16s)
  30k v 15k game 3: white+88.5 (12s)
  30k v 15k game 4: white+88.5 (11s)
  30k v 15k game 5: white+88.5 (12s)
  30k v 15k game 6: white+88.5 (15s)
  30k v 15k game 7: white+89.5 (12s)
  30k v 15k game 8: white+88.5 (11s)
== 30k v 15k: stronger side (W) 8/8 avg W-margin +88.9

==== SUMMARY ====
15k v 9k: stronger side (W) 7/10 avg W-margin +0.6
9k v 6k: stronger side (W) 9/10 avg W-margin +19.4
30k v 15k: stronger side (W) 8/8 avg W-margin +88.9
```
## Run 8 — iter-3b final ordering (15k = sweep winner rr.15/t2.2)
```
ladder check start 13:43:37
  15k v 9k game 1: white+55.5 (28s)
  15k v 9k game 2: white+20.5 (20s)
  15k v 9k game 3: black+22.5 (23s)
  15k v 9k game 4: white+2.5 (11s)
  15k v 9k game 5: white+88.5 (19s)
  15k v 9k game 6: white+16.5 (22s)
  15k v 9k game 7: white+88.5 (20s)
  15k v 9k game 8: white+23.5 (16s)
== 15k v 9k: stronger side (W) 7/8 avg W-margin +34.1
  30k v 15k game 1: white+88.5 (15s)
  30k v 15k game 2: white+88.5 (9s)
  30k v 15k game 3: white+89.5 (13s)
  30k v 15k game 4: white+88.5 (18s)
  30k v 15k game 5: white+88.5 (12s)
  30k v 15k game 6: white+88.5 (12s)
== 30k v 15k: stronger side (W) 6/6 avg W-margin +88.7

==== SUMMARY ====
15k v 9k: stronger side (W) 7/8 avg W-margin +34.1
30k v 15k: stronger side (W) 6/6 avg W-margin +88.7
```
## Run 9 — CANDIDATE-LADDER TOURNAMENT iter 1 (dinner run)
Candidates file: b28_candidates_9x9.yaml (18k rr.03/t3.5/rand.15 · 15k rr.07/t2.9/rand.08 · 12k rr.10/t2.6 · 9k rr.15/t2.2 · 6k rr.28/t1.7 · 3k rr.55/t1.15 · 1d rr.80/t1.0). 3-game sets, even (k 6.5) + handicap (3.5 pts/rank via komi). Histograms of new candidates appended.
```
  18k v 15k [even k=6.5] game 1: white+16.5 (28s)
  18k v 15k [even k=6.5] game 2: black+1.5 (28s)
  18k v 15k [even k=6.5] game 3: black+6.5 (28s)
== [1/22] 18k v 15k even: W 1/3, avg W-margin +2.8
  18k v 15k [handicap k=-4.5] game 1: white+10.5 (25s)
  18k v 15k [handicap k=-4.5] game 2: white+25.5 (26s)
  18k v 15k [handicap k=-4.5] game 3: black+24.5 (21s)
== [2/22] 18k v 15k handicap: W 2/3, avg W-margin +3.8
  18k v 12k [even k=6.5] game 1: white+14.5 (21s)
  18k v 12k [even k=6.5] game 2: white+10.5 (31s)
  18k v 12k [even k=6.5] game 3: black+14.5 (29s)
== [3/22] 18k v 12k even: W 2/3, avg W-margin +3.5
  18k v 12k [handicap k=-14.5] game 1: white+10.5 (19s)
  18k v 12k [handicap k=-14.5] game 2: white+22.5 (41s)
  18k v 12k [handicap k=-14.5] game 3: white+16.5 (31s)
== [4/22] 18k v 12k handicap: W 3/3, avg W-margin +16.5
  15k v 12k [even k=6.5] game 1: black+74.5 (17s)
  15k v 12k [even k=6.5] game 2: white+88.5 (31s)
  15k v 12k [even k=6.5] game 3: white+87.5 (28s)
== [5/22] 15k v 12k even: W 2/3, avg W-margin +33.8
  15k v 12k [handicap k=-4.5] game 1: black+5.5 (42s)
  15k v 12k [handicap k=-4.5] game 2: white+76.5 (22s)
  15k v 12k [handicap k=-4.5] game 3: black+51.5 (48s)
== [6/22] 15k v 12k handicap: W 1/3, avg W-margin +6.5
  15k v 9k [even k=6.5] game 1: white+31.5 (46s)
  15k v 9k [even k=6.5] game 2: white+42.5 (32s)
  15k v 9k [even k=6.5] game 3: white+12.5 (43s)
== [7/22] 15k v 9k even: W 3/3, avg W-margin +28.8
  15k v 9k [handicap k=-14.5] game 1: black+27.5 (24s)
  15k v 9k [handicap k=-14.5] game 2: white+6.5 (19s)
  15k v 9k [handicap k=-14.5] game 3: white+18.5 (28s)
== [8/22] 15k v 9k handicap: W 2/3, avg W-margin -0.8
  12k v 9k [even k=6.5] game 1: black+23.5 (50s)
  12k v 9k [even k=6.5] game 2: white+87.5 (22s)
  12k v 9k [even k=6.5] game 3: white+88.5 (26s)
== [9/22] 12k v 9k even: W 2/3, avg W-margin +50.8
  12k v 9k [handicap k=-4.5] game 1: white+32.5 (49s)
  12k v 9k [handicap k=-4.5] game 2: black+12.5 (25s)
  12k v 9k [handicap k=-4.5] game 3: white+12.5 (27s)
== [10/22] 12k v 9k handicap: W 2/3, avg W-margin +10.8
  12k v 6k [even k=6.5] game 1: white+87.5 (24s)
  12k v 6k [even k=6.5] game 2: black+73.5 (23s)
  12k v 6k [even k=6.5] game 3: white+66.5 (35s)
== [11/22] 12k v 6k even: W 2/3, avg W-margin +26.8
  12k v 6k [handicap k=-14.5] game 1: white+5.5 (25s)
  12k v 6k [handicap k=-14.5] game 2: white+18.5 (38s)
  12k v 6k [handicap k=-14.5] game 3: black+3.5 (27s)
== [12/22] 12k v 6k handicap: W 2/3, avg W-margin +6.8
  9k v 6k [even k=6.5] game 1: black+13.5 (29s)
  9k v 6k [even k=6.5] game 2: black+74.5 (30s)
  9k v 6k [even k=6.5] game 3: black+6.5 (29s)
== [13/22] 9k v 6k even: W 0/3, avg W-margin -31.5
  9k v 6k [handicap k=-4.5] game 1: black+21.5 (19s)
  9k v 6k [handicap k=-4.5] game 2: black+16.5 (37s)
  9k v 6k [handicap k=-4.5] game 3: white+36.5 (58s)
== [14/22] 9k v 6k handicap: W 1/3, avg W-margin -0.5
  9k v 3k [even k=6.5] game 1: black+12.5 (38s)
  9k v 3k [even k=6.5] game 2: white+37.5 (24s)
  9k v 3k [even k=6.5] game 3: white+11.5 (30s)
== [15/22] 9k v 3k even: W 2/3, avg W-margin +12.2
  9k v 3k [handicap k=-14.5] game 1: black+1.5 (34s)
  9k v 3k [handicap k=-14.5] game 2: black+11.5 (16s)
  9k v 3k [handicap k=-14.5] game 3: black+26.5 (27s)
== [16/22] 9k v 3k handicap: W 0/3, avg W-margin -13.2
  6k v 3k [even k=6.5] game 1: white+3.5 (22s)
  6k v 3k [even k=6.5] game 2: black+4.5 (12s)
  6k v 3k [even k=6.5] game 3: black+4.5 (25s)
== [17/22] 6k v 3k even: W 1/3, avg W-margin -1.8
  6k v 3k [handicap k=-4.5] game 1: white+77.5 (28s)
  6k v 3k [handicap k=-4.5] game 2: white+18.5 (35s)
  6k v 3k [handicap k=-4.5] game 3: white+76.5 (26s)
== [18/22] 6k v 3k handicap: W 3/3, avg W-margin +57.5
  6k v 1d [even k=6.5] game 1: white+3.5 (22s)
  6k v 1d [even k=6.5] game 2: black+0.5 (34s)
  6k v 1d [even k=6.5] game 3: white+6.5 (29s)
== [19/22] 6k v 1d even: W 2/3, avg W-margin +3.2
  6k v 1d [handicap k=-14.5] game 1: white+19.5 (26s)
  6k v 1d [handicap k=-14.5] game 2: white+67.5 (33s)
  6k v 1d [handicap k=-14.5] game 3: black+2.5 (27s)
== [20/22] 6k v 1d handicap: W 2/3, avg W-margin +28.2
  3k v 1d [even k=6.5] game 1: white+5.5 (33s)
  3k v 1d [even k=6.5] game 2: black+31.5 (20s)
  3k v 1d [even k=6.5] game 3: white+25.5 (33s)
== [21/22] 3k v 1d even: W 2/3, avg W-margin -0.2
  3k v 1d [handicap k=-4.5] game 1: white+6.5 (30s)
  3k v 1d [handicap k=-4.5] game 2: white+76.5 (29s)
  3k v 1d [handicap k=-4.5] game 3: white+76.5 (29s)
== [22/22] 3k v 1d handicap: W 3/3, avg W-margin +53.2

==== TOURNAMENT SUMMARY ====
pair         gap set         komi  W wins  avg W-margin
18k v 15k      3 even         6.5     1/3          +2.8
18k v 15k      3 handicap    -4.5     2/3          +3.8
18k v 12k      6 even         6.5     2/3          +3.5
18k v 12k      6 handicap   -14.5     3/3         +16.5
15k v 12k      3 even         6.5     2/3         +33.8
15k v 12k      3 handicap    -4.5     1/3          +6.5
15k v 9k       6 even         6.5     3/3         +28.8
15k v 9k       6 handicap   -14.5     2/3          -0.8
12k v 9k       3 even         6.5     2/3         +50.8
12k v 9k       3 handicap    -4.5     2/3         +10.8
12k v 6k       6 even         6.5     2/3         +26.8
12k v 6k       6 handicap   -14.5     2/3          +6.8
9k v 6k        3 even         6.5     0/3         -31.5
9k v 6k        3 handicap    -4.5     1/3          -0.5
9k v 3k        6 even         6.5     2/3         +12.2
9k v 3k        6 handicap   -14.5     0/3         -13.2
6k v 3k        3 even         6.5     1/3          -1.8
6k v 3k        3 handicap    -4.5     3/3         +57.5
6k v 1d        6 even         6.5     2/3          +3.2
6k v 1d        6 handicap   -14.5     2/3         +28.2
3k v 1d        3 even         6.5     2/3          -0.2
3k v 1d        3 handicap    -4.5     3/3         +53.2

even sets: stronger side wins 58% (want: high, gap-scaled)
handicap sets: stronger side wins 64% (want: ~50% if 3.5pts/rank is right)
=== HISTOGRAM PLACEMENT OF NEW CANDIDATES ===
--- candidate 18k (black-side games) ---

### bot games: /private/tmp/claude-501/-Users-patrickdowell-Projects-jarvis/b8ece97e-bddc-4c51-adc4-5b14e5a4a559/scratchpad/tournament.db rank=18k side=B
  game 14d5f695: 37 B-side moves analyzed
  game 5391b248: 41 B-side moves analyzed
  game cb781767: 41 B-side moves analyzed
  game bdac3c47: 33 B-side moves analyzed
  game 0a5da831: 38 B-side moves analyzed
  game 4b744a13: 31 B-side moves analyzed
  game edcd6bb9: 32 B-side moves analyzed
  game a74ec0c7: 47 B-side moves analyzed
  game 9199539d: 43 B-side moves analyzed
  game b4a5523e: 23 B-side moves analyzed
  game eca39efd: 50 B-side moves analyzed
  game 736d987b: 37 B-side moves analyzed

== bot (18k games, B side) — 453 moves
   mean loss +2.47  median +0.65
   near-optimal (<0.5): 45%
   small (0.5-2): 24%
   medium (2-5): 19%
   blunder (>=5): 13%
   locality: 44% of moves within 2 of the previous move (median dist 3.0)
--- candidate 15k (black-side games) ---

### bot games: /private/tmp/claude-501/-Users-patrickdowell-Projects-jarvis/b8ece97e-bddc-4c51-adc4-5b14e5a4a559/scratchpad/tournament.db rank=15k side=B
  game d3e969bc: 21 B-side moves analyzed
  game b3900461: 36 B-side moves analyzed
  game fbd0c1e3: 32 B-side moves analyzed
  game f27ac42d: 50 B-side moves analyzed
  game 66b5513d: 28 B-side moves analyzed
  game cc1af3e0: 55 B-side moves analyzed
  game 303ef849: 55 B-side moves analyzed
  game 11cb6fe2: 44 B-side moves analyzed
  game 36835478: 52 B-side moves analyzed
  game dcba8b53: 29 B-side moves analyzed
  game b79d2092: 23 B-side moves analyzed
  game 56da198a: 35 B-side moves analyzed

== bot (15k games, B side) — 460 moves
   mean loss +2.71  median +0.83
   near-optimal (<0.5): 43%
   small (0.5-2): 25%
   medium (2-5): 20%
   blunder (>=5): 13%
   locality: 38% of moves within 2 of the previous move (median dist 3)
--- candidate 12k (black-side games) ---

### bot games: /private/tmp/claude-501/-Users-patrickdowell-Projects-jarvis/b8ece97e-bddc-4c51-adc4-5b14e5a4a559/scratchpad/tournament.db rank=12k side=B
  game f093a9e3: 62 B-side moves analyzed
  game 7f528741: 26 B-side moves analyzed
  game e3baf3c6: 33 B-side moves analyzed
  game 011f0b52: 57 B-side moves analyzed
  game b3c13aa8: 34 B-side moves analyzed
  game 83aeb501: 31 B-side moves analyzed
  game 7f1f2fdc: 31 B-side moves analyzed
  game ce68ba0b: 27 B-side moves analyzed
  game cdcfa44f: 42 B-side moves analyzed
  game 79e8f6db: 31 B-side moves analyzed
  game dcb8ba68: 47 B-side moves analyzed
  game b1ac109e: 31 B-side moves analyzed

== bot (12k games, B side) — 452 moves
   mean loss +2.63  median +0.74
   near-optimal (<0.5): 43%
   small (0.5-2): 26%
   medium (2-5): 19%
   blunder (>=5): 12%
   locality: 35% of moves within 2 of the previous move (median dist 3)
--- candidate 6k (black-side games) ---

### bot games: /private/tmp/claude-501/-Users-patrickdowell-Projects-jarvis/b8ece97e-bddc-4c51-adc4-5b14e5a4a559/scratchpad/tournament.db rank=6k side=B
  game 7259e3b0: 29 B-side moves analyzed
  game c37d0eeb: 19 B-side moves analyzed
  game 722acbcb: 40 B-side moves analyzed
  game 0887f802: 34 B-side moves analyzed
  game 88a6e8ba: 43 B-side moves analyzed
  game ed7c6c92: 34 B-side moves analyzed
  game 2dff84b2: 29 B-side moves analyzed
  game d6ead640: 47 B-side moves analyzed
  game 8d67c1a4: 41 B-side moves analyzed
  game be519b71: 35 B-side moves analyzed
  game 11128228: 44 B-side moves analyzed
  game eec42853: 38 B-side moves analyzed

== bot (6k games, B side) — 433 moves
   mean loss +2.00  median +0.24
   near-optimal (<0.5): 58%
   small (0.5-2): 18%
   medium (2-5): 15%
   blunder (>=5): 9%
   locality: 45% of moves within 2 of the previous move (median dist 3.0)
--- candidate 1d (white side of 3k games) ---

### bot games: /private/tmp/claude-501/-Users-patrickdowell-Projects-jarvis/b8ece97e-bddc-4c51-adc4-5b14e5a4a559/scratchpad/tournament.db rank=3k side=W
  game f78c0f0c: 47 W-side moves analyzed
  game 67e55468: 32 W-side moves analyzed
  game 8fd766b4: 47 W-side moves analyzed
  game 82742621: 41 W-side moves analyzed
  game cbacc15c: 40 W-side moves analyzed
  game 716ea563: 40 W-side moves analyzed

== bot (3k games, W side) — 247 moves
   mean loss +1.45  median +0.10
   near-optimal (<0.5): 69%
   small (0.5-2): 17%
   medium (2-5): 9%
   blunder (>=5): 5%
   locality: 40% of moves within 2 of the previous move (median dist 3)
```
## Run 10 — candidates iter 2 (18k rand→.30, 15k rand→.14) — IN PROGRESS at compile time
```
  18k v 15k [even k=6.5] game 1: black+18.5 (43s)
  18k v 15k [even k=6.5] game 2: white+34.5 (18s)
  18k v 15k [even k=6.5] game 3: white+12.5 (17s)
  18k v 15k [even k=6.5] game 4: black+11.5 (23s)
== 18k v 15k even (k=6.5): W 2/4, avg W-margin +4.2
  18k v 15k [handicap k=-4.5] game 1: black+26.5 (22s)
  18k v 15k [handicap k=-4.5] game 2: black+3.5 (38s)
  18k v 15k [handicap k=-4.5] game 3: white+4.5 (17s)
  18k v 15k [handicap k=-4.5] game 4: black+13.5 (29s)
== 18k v 15k handicap (k=-4.5): W 1/4, avg W-margin -9.8
  18k v 12k [even k=6.5] game 1: white+40.5 (34s)
  18k v 12k [even k=6.5] game 2: black+23.5 (40s)
  18k v 12k [even k=6.5] game 3: white+87.5 (24s)
  18k v 12k [even k=6.5] game 4: black+47.5 (32s)
== 18k v 12k even (k=6.5): W 2/4, avg W-margin +14.2
  15k v 12k [even k=6.5] game 1: white+53.5 (37s)
  15k v 12k [even k=6.5] game 2: black+14.5 (31s)
```
