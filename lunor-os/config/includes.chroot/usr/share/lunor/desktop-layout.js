// LUNOR OS 1.2 — Plasma desktop layout
// Three-zone desktop: top status strip, left quick shelf, bottom-center launcher.

var existing = panels();
for (var i = existing.length - 1; i >= 0; --i) {
    existing[i].remove();
}

function configWidget(widget, group, values) {
    widget.currentConfigGroup = group;
    for (var key in values) {
        widget.writeConfig(key, values[key]);
    }
    widget.reloadConfig();
}

// Top status strip
var top = new Panel;
top.screen = 0;
top.location = "top";
top.alignment = "left";
top.lengthMode = "fill";
top.height = 32;
top.floating = false;
top.opacity = "translucent";
top.hiding = "none";

var menu = top.addWidget("org.kde.plasma.kickoff");
configWidget(menu, ["Configuration", "General"], {
    "icon": "lunor",
    "menuLabel": "LUNOR",
    "favorites": [
        "preferred://browser",
        "preferred://filemanager",
        "applications:org.kde.konsole.desktop",
        "applications:systemsettings.desktop"
    ],
    "showActionButtonCaptions": false,
    "compactMode": true
});

var topSpacer = top.addWidget("org.kde.plasma.panelspacer");
configWidget(topSpacer, ["Configuration", "General"], {
    "expanding": true
});

top.addWidget("org.kde.plasma.systemtray");

var clock = top.addWidget("org.kde.plasma.digitalclock");
configWidget(clock, ["Configuration", "Appearance"], {
    "showDate": true,
    "dateFormat": "custom",
    "customDateFormat": "ddd d",
    "dateDisplayFormat": 1,
    "showSeconds": 0
});

// Left quick shelf
var shelf = new Panel;
shelf.screen = 0;
shelf.location = "left";
shelf.alignment = "center";
shelf.lengthMode = "fit";
shelf.height = 50;
shelf.floating = true;
shelf.floatingApplets = true;
shelf.opacity = "translucent";
shelf.hiding = "none";

shelf.addWidget("org.kde.plasma.pager");
shelf.addWidget("org.kde.plasma.marginsseparator");
shelf.addWidget("org.kde.plasma.showdesktop");

// Bottom-center launcher
var dock = new Panel;
dock.screen = 0;
dock.location = "bottom";
dock.alignment = "center";
dock.lengthMode = "fit";
dock.height = 58;
dock.floating = true;
dock.floatingApplets = true;
dock.opacity = "translucent";
dock.hiding = "dodgewindows";

var tasks = dock.addWidget("org.kde.plasma.icontasks");
configWidget(tasks, ["Configuration", "General"], {
    "launchers": [
        "preferred://filemanager",
        "preferred://browser",
        "applications:org.kde.konsole.desktop",
        "applications:systemsettings.desktop"
    ],
    "showOnlyCurrentDesktop": true,
    "showOnlyCurrentActivity": true,
    "separateLaunchers": false,
    "hideLauncherOnStart": false,
    "maxStripes": 1,
    "forceStripes": false,
    "showToolTips": true,
    "fill": false,
    "iconSpacing": 1
});

// Keep the desktop itself visually quiet and on the LUNOR wallpaper.
var ds = desktops();
for (var d = 0; d < ds.length; ++d) {
    ds[d].wallpaperPlugin = "org.kde.image";
    ds[d].currentConfigGroup = ["Wallpaper", "org.kde.image", "General"];
    ds[d].writeConfig("Image", "file:///usr/share/wallpapers/LUNOR/lunor-wallpaper.png");
    ds[d].writeConfig("FillMode", 2);
}
