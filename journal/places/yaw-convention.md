---
type: concept
name: yaw_convention
confirmed: true
---

# Yaw Convention

Confirmed in play. Yaw is in radians.

| Yaw | Direction | Axis change |
|---|---|---|
| `0` | north | -z |
| `π/2 ≈ 1.5708` | west | -x |
| `π ≈ 3.1416` | south | +z |
| `-π/2 ≈ -1.5708` | east | +x |

## Convergence

After issuing a `look` command, do not assume the rotation took. Read `rawState.yaw` and confirm it is within ~0.25 rad of the target before issuing forward motion. The server occasionally swallows or delays rotation packets. The `look_at` background tracker has since been removed (`suppressLookAt` is now a no-op, `lookAtEnabled` defaults to false, and nothing reads the flag), so there is no longer anything to suppress during door procedures.

See [[orientation-blocks]] for why this matters.
