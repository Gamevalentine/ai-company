import QtQml
import QtQuick
import QtQuick.Controls
import org.kde.plasma.private.sessions

Item {
    id: root

    property bool debug: false
    property bool viewVisible: false
    property bool locked: false
    property string notification: ""
    signal clearPassword()
    signal notificationRepeated()

    implicitWidth: 1280
    implicitHeight: 720
    focus: true

    property bool interactionStarted: false
    property real introTime: 0

    function isVietnamese() {
        return Qt.locale().name.toLowerCase().indexOf("vi") === 0
    }
    function t(en, vi) {
        return isVietnamese() ? vi : en
    }
    function beginAuth() {
        interactionStarted = true
        authenticator.startAuthenticating()
        password.forceActiveFocus()
    }

    Image {
        id: background
        anchors.fill: parent
        source: "file:///usr/share/wallpapers/LUNOR/lockscreen.png"
        fillMode: Image.PreserveAspectCrop
        smooth: true
        opacity: 0
    }

    Rectangle {
        anchors.fill: parent
        color: "#02050A"
        opacity: 0.24
    }

    Image {
        id: logo
        width: Math.min(132, root.width * 0.10)
        height: width
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: parent.top
        anchors.topMargin: Math.max(52, parent.height * 0.09)
        source: "file:///usr/share/pixmaps/lunor.png"
        fillMode: Image.PreserveAspectFit
        smooth: true
        opacity: 0
        scale: 0.96
    }

    Text {
        id: clock
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.verticalCenter: parent.verticalCenter
        anchors.verticalCenterOffset: -98
        text: Qt.formatTime(new Date(), "hh:mm")
        color: "#F5F8FF"
        font.family: "Noto Sans"
        font.pixelSize: Math.max(54, root.height * 0.10)
        font.weight: Font.Light
        opacity: 0
        Timer {
            interval: 1000
            running: true
            repeat: true
            onTriggered: {
                clock.text = Qt.formatTime(new Date(), "hh:mm")
                dateText.text = Qt.formatDate(new Date(), "dddd, d MMMM yyyy")
            }
        }
    }

    Text {
        id: dateText
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: clock.bottom
        anchors.topMargin: 4
        text: Qt.formatDate(new Date(), "dddd, d MMMM yyyy")
        color: "#AFC7E8"
        font.family: "Noto Sans"
        font.pixelSize: Math.max(14, root.height * 0.024)
        opacity: clock.opacity
    }

    Text {
        id: headline
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: dateText.bottom
        anchors.topMargin: 28
        text: root.t("Welcome back", "Chào mừng trở lại")
        color: "#F5F8FF"
        font.family: "Noto Sans"
        font.pixelSize: Math.max(22, root.height * 0.036)
        font.weight: Font.Medium
        opacity: 0
        transform: Translate { id: headlineMove; y: 12 }
    }

    Text {
        id: subline
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: headline.bottom
        anchors.topMargin: 7
        text: root.t("Unlock to continue", "Mở khóa để tiếp tục")
        color: "#9EC9FF"
        font.family: "Noto Sans"
        font.pixelSize: Math.max(13, root.height * 0.020)
        opacity: 0
        transform: Translate { id: sublineMove; y: 12 }
    }

    Column {
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: subline.bottom
        anchors.topMargin: 24
        spacing: 10
        width: Math.min(380, root.width - 48)
        opacity: interactionStarted ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: 260; easing.type: Easing.OutCubic } }

        TextField {
            id: password
            width: parent.width
            height: 52
            placeholderText: root.t("Password", "Mật khẩu")
            echoMode: TextInput.Password
            color: "#F5F8FF"
            placeholderTextColor: "#7C94B5"
            leftPadding: 18
            rightPadding: 18
            background: Rectangle {
                radius: 16
                color: "#B30A1324"
                border.width: password.activeFocus ? 1 : 0
                border.color: "#9EC9FF"
            }
            Keys.onReturnPressed: authenticator.respond(password.text)
        }

        Button {
            width: parent.width
            height: 48
            text: root.t("Unlock", "Mở khóa")
            onClicked: authenticator.respond(password.text)
        }

        Text {
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            text: root.notification
            color: "#FFB4B4"
            font.pixelSize: 12
            visible: text.length > 0
        }
    }

    SequentialAnimation {
        id: intro
        running: true

        ParallelAnimation {
            NumberAnimation { target: background; property: "opacity"; from: 0; to: 1; duration: 800; easing.type: Easing.OutCubic }
        }
        ParallelAnimation {
            NumberAnimation { target: logo; property: "opacity"; from: 0; to: 1; duration: 800; easing.type: Easing.OutCubic }
            NumberAnimation { target: logo; property: "scale"; from: 0.96; to: 1.0; duration: 800; easing.type: Easing.OutCubic }
            NumberAnimation { target: clock; property: "opacity"; from: 0; to: 1; duration: 800; easing.type: Easing.OutCubic }
        }
        ParallelAnimation {
            NumberAnimation { target: headline; property: "opacity"; from: 0; to: 1; duration: 700; easing.type: Easing.OutCubic }
            NumberAnimation { target: headlineMove; property: "y"; from: 12; to: 0; duration: 700; easing.type: Easing.OutCubic }
        }
        ParallelAnimation {
            NumberAnimation { target: subline; property: "opacity"; from: 0; to: 1; duration: 700; easing.type: Easing.OutCubic }
            NumberAnimation { target: sublineMove; property: "y"; from: 12; to: 0; duration: 700; easing.type: Easing.OutCubic }
            ScriptAction { script: root.beginAuth() }
        }
    }

    Connections {
        target: authenticator

        function onFailed(kind) {
            root.notification = root.t("Unlocking failed", "Mở khóa thất bại")
            password.selectAll()
            password.forceActiveFocus()
            authenticator.startAuthenticating()
        }

        function onSucceeded() {
            Qt.quit()
        }

        function onInfoMessageChanged() {
            if (authenticator.infoMessage)
                root.notification = authenticator.infoMessage
        }

        function onErrorMessageChanged() {
            if (authenticator.errorMessage)
                root.notification = authenticator.errorMessage
        }

        function onPromptForSecretChanged() {
            password.forceActiveFocus()
        }
    }

    onViewVisibleChanged: {
        if (viewVisible && !interactionStarted && !intro.running)
            beginAuth()
    }

    Keys.onPressed: function(event) {
        if (!interactionStarted) {
            beginAuth()
            event.accepted = false
        }
    }

    onClearPassword: password.clear()
}
