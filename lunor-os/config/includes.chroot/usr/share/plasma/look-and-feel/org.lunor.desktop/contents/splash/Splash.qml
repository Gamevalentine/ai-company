import QtQuick 2.15

Rectangle {
    id: root
    color: "#02050A"

    property int stage

    function isVietnamese() {
        return Qt.locale().name.toLowerCase().indexOf("vi") === 0
    }

    function t(en, vi) {
        return isVietnamese() ? vi : en
    }

    onStageChanged: {
        if (stage === 2 && !intro.running && content.opacity === 0) {
            intro.start()
        } else if (stage >= 5) {
            outro.start()
        }
    }

    Item {
        id: content
        anchors.fill: parent
        opacity: 0

        Image {
            id: background
            anchors.fill: parent
            source: "file:///usr/share/wallpapers/LUNOR/lunor-wallpaper.png"
            fillMode: Image.PreserveAspectCrop
            smooth: true
            opacity: 0
        }

        Rectangle {
            anchors.fill: parent
            color: "#02050A"
            opacity: 0.20
        }

        Image {
            id: logo
            width: Math.min(180, root.width * 0.12)
            height: width
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.verticalCenter: parent.verticalCenter
            anchors.verticalCenterOffset: -92
            source: "file:///usr/share/pixmaps/lunor.png"
            fillMode: Image.PreserveAspectFit
            smooth: true
            opacity: 0
            scale: 0.96
        }

        Text {
            id: headline
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.top: logo.bottom
            anchors.topMargin: 26
            text: root.t("Welcome to LUNOR OS", "Chào mừng đến với LUNOR OS")
            color: "#F5F8FF"
            font.family: "Noto Sans"
            font.pixelSize: Math.max(28, root.height * 0.040)
            font.weight: Font.Light
            opacity: 0
            transform: Translate { id: headlineMove; y: 12 }
        }

        Text {
            id: subline
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.top: headline.bottom
            anchors.topMargin: 10
            text: root.t("Clean. Calm. Ready.", "Gọn gàng. Êm dịu. Sẵn sàng.")
            color: "#9EC9FF"
            font.family: "Noto Sans"
            font.pixelSize: Math.max(14, root.height * 0.020)
            font.letterSpacing: 1
            opacity: 0
            transform: Translate { id: sublineMove; y: 12 }
        }
    }

    SequentialAnimation {
        id: intro
        running: false

        ScriptAction { script: content.opacity = 1 }

        NumberAnimation {
            target: background
            property: "opacity"
            from: 0
            to: 1
            duration: 800
            easing.type: Easing.OutCubic
        }

        ParallelAnimation {
            NumberAnimation { target: logo; property: "opacity"; from: 0; to: 1; duration: 800; easing.type: Easing.OutCubic }
            NumberAnimation { target: logo; property: "scale"; from: 0.96; to: 1.0; duration: 800; easing.type: Easing.OutCubic }
        }

        ParallelAnimation {
            NumberAnimation { target: headline; property: "opacity"; from: 0; to: 1; duration: 700; easing.type: Easing.OutCubic }
            NumberAnimation { target: headlineMove; property: "y"; from: 12; to: 0; duration: 700; easing.type: Easing.OutCubic }
        }

        ParallelAnimation {
            NumberAnimation { target: subline; property: "opacity"; from: 0; to: 1; duration: 700; easing.type: Easing.OutCubic }
            NumberAnimation { target: sublineMove; property: "y"; from: 12; to: 0; duration: 700; easing.type: Easing.OutCubic }
        }
    }

    NumberAnimation {
        id: outro
        target: content
        property: "opacity"
        from: content.opacity
        to: 0
        duration: 250
        easing.type: Easing.InOutQuad
    }

    Component.onCompleted: {
        // Some Plasma builds expose stage before this component is fully loaded.
        if (stage >= 2 && stage < 5)
            intro.start()
    }
}
