# LUNOR OS 1.2

Third milestone of LUNOR OS, built on the 1.1 visual identity.

- Base: Debian 13 (trixie)
- Desktop engine: KDE Plasma
- Installer: Calamares
- Codename: Aurora
- Live user: `lunor`
- Live password: `live`

## What 1.2 adds

1. LUNOR three-zone desktop layout.
2. Slim top status strip with LUNOR launcher, system tray and clock.
3. Centered left quick shelf for workspace controls.
4. Floating bottom-center icons-only launcher/task dock.
5. LUNOR menu icon and curated default launcher set.
6. Desktop layout is applied using Plasma's supported D-Bus scripting API.

## 1.2 acceptance criteria

1. Boots and logs in without breaking the 1.1 boot/login/lock-screen experience.
2. Reaches a Plasma desktop using the LUNOR 1.2 layout instead of the stock single panel.
3. Top strip, left shelf and bottom launcher are all present and usable.
4. LUNOR application menu opens from the top-left launcher.
5. Default pinned apps launch correctly.
6. Installer remains available.
7. Produces a downloadable hybrid ISO for VM testing.
