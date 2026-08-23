# Vendored `arrayref` source

This directory is an exact source copy of `arrayref` `0.3.9` at immutable
upstream commit `f8d0299d863922db6c409d08098941e833b70d69` from
`droundy/arrayref`. The copy is used only to replace the yanked registry
package selected transitively by `blake3`; no source behavior was changed.

The upstream Git repository is currently unavailable to CI, so a remote Git
URL cannot provide reproducible builds. The source is therefore kept as a
small, explicit Cargo path patch. The upstream BSD-2-Clause license is
retained in `LICENSE`.
