import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import SddmComponents 2.0

Rectangle {
    id: root
    width: 1920
    height: 1080
    color: "#02050A"

    property string errorMessage: ""
    property bool loggingIn: false

    function isVietnamese() {
        return Qt.locale().name.toLowerCase().indexOf("vi") === 0
    }
    function t(en, vi) {
        return isVietnamese() ? vi : en
    }

    Image {
        id: background
        anchors.fill: parent
        source: "background.png"
        fillMode: Image.PreserveAspectCrop
        smooth: true
        asynchronous: true
        opacity: 0
    }

    Rectangle {
        anchors.fill: parent
        color: "#02050A"
        opacity: 0.18
    }

    Image {
        id: logo
        width: 118
        height: 118
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: parent.top
        anchors.topMargin: Math.max(72, parent.height * 0.10)
        source: "logo.png"
        fillMode: Image.PreserveAspectFit
        smooth: true
        opacity: 0
        scale: 0.96
    }

    Label {
        id: welcomeTitle
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: logo.bottom
        anchors.topMargin: 20
        text: root.t("Welcome", "Chào mừng")
        color: "#F5F8FF"
        font.family: "Noto Sans"
        font.pixelSize: 28
        font.weight: Font.Light
        opacity: 0
        transform: Translate { id: titleMove; y: 12 }
    }

    Label {
        id: welcomeSubline
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: welcomeTitle.bottom
        anchors.topMargin: 8
        text: root.t("Sign in to continue", "Đăng nhập để tiếp tục")
        color: "#9EC9FF"
        font.family: "Noto Sans"
        font.pixelSize: 13
        opacity: 0
        transform: Translate { id: sublineMove; y: 12 }
    }

    ColumnLayout {
        id: loginPanel
        width: Math.min(420, parent.width - 48)
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.verticalCenter: parent.verticalCenter
        anchors.verticalCenterOffset: 115
        spacing: 16
        opacity: 0
        transform: Translate { id: panelMove; y: 12 }

        Label {
            Layout.alignment: Qt.AlignHCenter
            Layout.bottomMargin: 12
            text: Qt.formatTime(new Date(), "hh:mm") + "  •  " + Qt.formatDate(new Date(), "ddd d MMM")
            color: "#AFC7E8"
            opacity: 0.84
            font.family: "Noto Sans"
            font.pixelSize: 13

            Timer {
                interval: 30000
                repeat: true
                running: true
                onTriggered: parent.text = Qt.formatTime(new Date(), "hh:mm") + "  •  " + Qt.formatDate(new Date(), "ddd d MMM")
            }
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 56
            radius: 16
            color: "#B30A1324"
            border.width: username.activeFocus ? 1 : 0
            border.color: "#9EC9FF"

            TextField {
                id: username
                anchors.fill: parent
                anchors.margins: 4
                leftPadding: 18
                rightPadding: 18
                placeholderText: root.t("Username", "Tên đăng nhập")
                text: userModel.lastUser
                color: "#F5F8FF"
                placeholderTextColor: "#7C94B5"
                background: null
                selectByMouse: true
                font.family: "Noto Sans"
                font.pixelSize: 15
                Keys.onReturnPressed: password.forceActiveFocus()
            }
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 56
            radius: 16
            color: "#B30A1324"
            border.width: password.activeFocus ? 1 : 0
            border.color: "#9EC9FF"

            TextField {
                id: password
                anchors.fill: parent
                anchors.margins: 4
                leftPadding: 18
                rightPadding: 18
                placeholderText: root.t("Password", "Mật khẩu")
                echoMode: TextInput.Password
                color: "#F5F8FF"
                placeholderTextColor: "#7C94B5"
                background: null
                selectByMouse: true
                font.family: "Noto Sans"
                font.pixelSize: 15
                Keys.onReturnPressed: root.performLogin()
            }
        }

        Button {
            id: loginButton
            Layout.fillWidth: true
            Layout.preferredHeight: 52
            enabled: !root.loggingIn && username.text.length > 0
            text: root.loggingIn ? root.t("Signing in…", "Đang đăng nhập…") : root.t("Sign in", "Đăng nhập")

            contentItem: Text {
                text: loginButton.text
                color: "#02050A"
                horizontalAlignment: Text.AlignHCenter
                verticalAlignment: Text.AlignVCenter
                font.family: "Noto Sans"
                font.pixelSize: 15
                font.weight: Font.Medium
            }

            background: Rectangle {
                radius: 16
                color: loginButton.enabled ? "#DCEBFF" : "#7A8A9C"
                opacity: loginButton.down ? 0.86 : 1
            }

            onClicked: root.performLogin()
        }

        Label {
            Layout.alignment: Qt.AlignHCenter
            Layout.minimumHeight: 20
            text: root.errorMessage
            visible: text.length > 0
            color: "#FFB4B4"
            font.family: "Noto Sans"
            font.pixelSize: 12
        }

        ComboBox {
            id: sessionChooser
            Layout.alignment: Qt.AlignHCenter
            Layout.preferredWidth: 220
            model: sessionModel
            textRole: "name"
            currentIndex: sessionModel.lastIndex >= 0 ? sessionModel.lastIndex : 0
            visible: count > 1
        }
    }

    Row {
        id: powerRow
        anchors.left: parent.left
        anchors.bottom: parent.bottom
        anchors.margins: 28
        spacing: 8
        opacity: loginPanel.opacity

        Button {
            width: 104
            height: 38
            text: root.t("Restart", "Khởi động lại")
            onClicked: sddm.reboot()
        }

        Button {
            width: 104
            height: 38
            text: root.t("Power off", "Tắt máy")
            onClicked: sddm.powerOff()
        }
    }

    Label {
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.margins: 30
        text: "LUNOR OS 1.1"
        color: "#6F8CAF"
        font.family: "Noto Sans"
        font.pixelSize: 11
        font.letterSpacing: 1
        opacity: loginPanel.opacity
    }

    SequentialAnimation {
        id: intro
        running: true

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
            NumberAnimation { target: welcomeTitle; property: "opacity"; from: 0; to: 1; duration: 700; easing.type: Easing.OutCubic }
            NumberAnimation { target: titleMove; property: "y"; from: 12; to: 0; duration: 700; easing.type: Easing.OutCubic }
        }

        ParallelAnimation {
            NumberAnimation { target: welcomeSubline; property: "opacity"; from: 0; to: 1; duration: 700; easing.type: Easing.OutCubic }
            NumberAnimation { target: sublineMove; property: "y"; from: 12; to: 0; duration: 700; easing.type: Easing.OutCubic }
            NumberAnimation { target: loginPanel; property: "opacity"; from: 0; to: 1; duration: 700; easing.type: Easing.OutCubic }
            NumberAnimation { target: panelMove; property: "y"; from: 12; to: 0; duration: 700; easing.type: Easing.OutCubic }
        }
    }

    function performLogin() {
        if (username.text.length === 0 || root.loggingIn)
            return

        root.errorMessage = ""
        root.loggingIn = true
        sddm.login(username.text, password.text, sessionChooser.currentIndex)
    }

    Connections {
        target: sddm

        function onLoginFailed() {
            root.loggingIn = false
            root.errorMessage = root.t("Incorrect username or password", "Tên đăng nhập hoặc mật khẩu không đúng")
            password.selectAll()
            password.forceActiveFocus()
        }

        function onLoginSucceeded() {
            root.errorMessage = ""
        }
    }

    Component.onCompleted: {
        if (username.text.length > 0)
            password.forceActiveFocus()
        else
            username.forceActiveFocus()
    }
}
