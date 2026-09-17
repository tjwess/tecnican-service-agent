# Tecnican Service Agent

Public application repository for the Tecnican Service Agent.

The Agent connects to a GLPI installation running the private Tecnican plugin API. This repository contains only distributable client applications and their build/release automation. It does not contain the GLPI plugin, infrastructure definitions, Portainer automation, credentials, or customer data.

## Current Application

The dependency-free browser client is available in `web/`. Serve that directory with a static HTTP server and enter the URL of a compatible GLPI installation.

```bash
python3 -m http.server 5180 --directory web
```

## Desktop Roadmap

Phase N will package the shared Agent UI with Tauri and produce:

- Windows x64 installers;
- macOS Universal applications for Intel and Apple Silicon;
- GitHub Actions build artifacts;
- signed and notarized releases when signing credentials are configured.

## Security

Do not commit GLPI credentials, API tokens, signing certificates, `.env` files, or customer-specific URLs. The Agent stores its runtime session locally in the user's browser or desktop profile.

## License

GPL-3.0-or-later. See `LICENSE`.
