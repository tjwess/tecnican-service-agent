# Tecnican Service Agent

Public application repository for the Tecnican Service Agent.

The Agent connects to a GLPI installation running the private Tecnican plugin API. This repository contains only distributable client applications and their build/release automation. It does not contain the GLPI plugin, infrastructure definitions, Portainer automation, credentials, or customer data.

## Applications

The shared, dependency-free client is available in `web/`. Serve that directory with a static HTTP server for browser use, or package it as a native desktop application with Tauri 2.

```bash
python3 -m http.server 5180 --directory web
```

### Local desktop development

Install the Tauri prerequisites for your operating system, then run:

```bash
npm install
npm run icons
npm run desktop
```

### Installers

Every relevant push to `main` builds downloadable GitHub Actions artifacts:

- Windows x64: MSI and NSIS installers;
- macOS Universal: one DMG for Intel and Apple Silicon.

The current macOS artifact uses ad-hoc signing. Apple Developer signing and notarization will be enabled when the required certificates and credentials are configured as repository secrets.

The desktop Agent keeps running in the Windows notification area or macOS menu bar when its window is minimized or closed. Use the tray icon to reopen it, or choose `Sair` to terminate the process.

## Security

Do not commit GLPI credentials, API tokens, signing certificates, `.env` files, or customer-specific URLs. The Agent stores its runtime session locally in the user's browser or desktop profile.

## License

GPL-3.0-or-later. See `LICENSE`.
