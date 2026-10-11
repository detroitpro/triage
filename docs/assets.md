# Generated assets

Characters under `web/public/assets/npc/` are generated with Meshy by `scripts/assets/`
(charter "Look"). The manifest (`web/public/assets/manifest.json`) records, per asset, the
prompt, the request bodies, the Meshy task ids, the licence, and the date.

## Pipeline

```bash
npx tsx scripts/assets/character.ts <form> --stop-after concept   # ~6 credits: inspect asset-work/<form>/concept.png
npx tsx scripts/assets/character.ts <form>                         # model (30), rig (5), animations (3 each)
npx tsx scripts/assets/pack.ts <form>                              # compress into web/public/assets + manifest
```

The run is resumable and never pays twice for an accepted task. If a run stops with
"submission may have been accepted" or a FAILED task, check the Meshy task list, then rerun
with `--retry <stage>` (this forgets that stage and the ones after it).

## Licence basis (checked 2026-10-11)

Meshy Terms of Use (https://www.meshy.ai/terms-of-use), as read on 2026-10-11:

- §3.2: customers on a paid Meshy plan own their Customer Output. Free-plan output is owned by
  Meshy and licensed CC BY 4.0, which would require attribution.
- §3.1: service assets (rigs, library animations) are licensed as incorporated into the output.
- §2.4: AI-identifying metadata or watermarks must not be removed. The generated GLBs carry
  none (their generator field is Blender's glTF exporter), so packing removes nothing.
- §2.6: generated assets must not be used to train competing AI models.

The four characters were generated on 2026-10-11 on the account behind `MESHY_API_KEY`, a paid
Meshy plan (confirmed by the account owner on 2026-10-11), so the output is ours under §3.2 and
needs no attribution. If that plan lapses, assets generated afterwards fall under the free-plan
terms and need attribution.
