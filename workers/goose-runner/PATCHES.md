# Goose runner patch set

The P5.1 runner applies no source patch to Goose `v1.45.0`. Its patch series is
empty and therefore has SHA-256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

Dependency resolution remains Actestra-owned through the committed runner
`Cargo.lock`. In particular, the first admitted lock must resolve
`event-listener` `5.4.2` or newer without modifying Goose source.
