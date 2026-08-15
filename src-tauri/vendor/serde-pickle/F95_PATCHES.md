# Vendored serde-pickle (patched)

Based on `serde-pickle` 1.2.0.

## Patches for Ren'Py saves

Ren'Py builds `RevertableList` / `RevertableSet` with pickle `NEWOBJ` then `APPEND` /
`ADDITEMS`. Upstream recovers unknown classes as empty **dicts**, so `APPEND` fails
(`InvalidStackTop: expected list, got Dict`).

Changes in `src/de.rs`:

1. Map `renpy.python` / `renpy.revertable` `RevertableList` → `Global::List` and
   `RevertableSet` → `Global::Set`.
3. When converting dicts/sets, **skip unhashable keys/items** (recovered custom
   objects) instead of failing the whole save with `ValueNotHashable`.
