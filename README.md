# NOVACORE

NovaCore is an independent technology ecosystem by Nova Industries, bringing together graphics, AI, software development, cloud computing and experimental technologies. Built to explore ideas and turn them into reality.

## Repository layout

- `app/` — NovaCore 3.10.0 application source (Node.js/Express server, SQLite storage, web client, Electron desktop shell, C++ Nova Engine Workbench, tests and documentation).
- `launch-kit/` — public launch material: reproducible proofs, press kit, channel messages and the launch checklist.

Build outputs, runtime data, local databases, dependency folders and `.env*` files are intentionally excluded. The production releases are published as Windows installers outside this repository.

## Quick start

```sh
cd app
npm install
npm test
npm start
```

See `app/README.md` and `app/CHANGELOG.md` for version details, verification commands and release hashes.
