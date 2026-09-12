# Vendored assets

`ghostty-web.js` and `ghostty-vt.wasm` are unmodified build artifacts from
[`ghostty-web`](https://github.com/coder/ghostty-web) v0.4.0, MIT licensed,
Copyright (c) 2025 Coder. See `ghostty-web.LICENSE`.

They are vendored rather than installed because this fork has no npm/bun
toolchain: the Go server serves these files as static assets. The WASM is loaded
by the browser at `./ghostty-vt.wasm` (a copy sits at the `web/` root, which is
where `ghostty-web` looks first).
