# LUNOR OS 1.1

Second milestone of LUNOR OS, built on the stable 1.0 base.

- Base: Debian 13 (trixie)
- Desktop: KDE Plasma
- Installer: Calamares
- Codename: Aurora
- Live user: `lunor`
- Live password: `live`

## What 1.1 adds

1. LUNOR Plymouth boot theme.
2. LUNOR SDDM login theme.
3. LUNOR lock-screen branding.
4. LUNOR desktop wallpaper set and base color scheme.
5. System-wide LUNOR OS 1.1 identity and release branding.

## 1.1 acceptance criteria

1. Boots in BIOS and UEFI virtual machines.
2. Shows LUNOR branding during boot, login, lock screen and desktop.
3. Reports itself as **LUNOR OS 1.1 (Aurora)** through standard release metadata.
4. Keeps networking, audio and the KDE Plasma session working.
5. Keeps the **Install LUNOR OS** Calamares shortcut working.
6. Produces a downloadable hybrid ISO for VM testing.
