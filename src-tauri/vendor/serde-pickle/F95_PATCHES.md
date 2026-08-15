# Vendored serde-pickle (patched)

Based on `serde-pickle` 1.2.0.

## Patches for Ren'Py saves

Ren'Py builds `RevertableList` / `RevertableSet` with pickle `NEWOBJ` then `APPEND` /
`ADDITEMS`. Upstream recovers unknown classes as empty **dicts**, so `APPEND` fails
(`InvalidStackTop: expected list, got Dict`).

Changes in `src/de.rs`:

1. Map `renpy.python` / `renpy.revertable` `RevertableList` → `Global::List` and
   `RevertableSet` → `Global::Set`.
2. On `NEWOBJ`, if the class is `List` or `Set`/`Frozenset`, push an empty list/set
   instead of an empty dict.
