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

    Image {
        anchors.fill: parent
        source: "background.png"
        fillMode: Image.PreserveAspectCrop
        smooth: true
        asynchronous: true
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
        anchors.topMargin: Math.max(72, parent.height * 0.11)
        source: "logo.png"
        fillMode: Image.PreserveAspectFit
        smooth: true
        opacity: 0

        Behavior on opacity { NumberAnimation { duration: 700; easing.type: Easing.OutCubic } }

        Component.onCompleted: opacity = 1
    }

    ColumnLayout {
        id: loginPanel
        width: Math.min(420, parent.width - 48)
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.verticalCenter: parent.verticalCenter
        anchors.verticalCenterOffset: 70
        spacing: 16

        Label {
            Layout.alignment: Qt.AlignHCenter
            text: "LUNOR OS"
            color: "#F5F8FF"
            font.family: "Noto Sans"
            font.pixelSize: 26
            font.weight: Font.Light
            font.letterSpacing: 5
        }

        Label {
            Layout.alignment: Qt.AlignHCenter
            Layout.bottomMargin: 18
            text: Qt.formatTime(new Date(), "hh:mm") + "  •  " + Qt.formatDate(new Date(), "ddd d MMM")
            color: "#9EC9FF"
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
                placeholderText: "Username"
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
                placeholderText: "Password"
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
            text: root.loggingIn ? "Signing in…" : "Sign in"

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

            contentItem: Text {
                leftPadding: 12
                rightPadding: 28
                text: sessionChooser.displayText
                color: "#AFC7E8"
                verticalAlignment: Text.AlignVCenter
                font.family: "Noto Sans"
                font.pixelSize: 12
                elide: Text.ElideRight
            }

            background: Rectangle {
                radius: 12
                color: "#660A1324"
                border.width: 1
                border.color: "#334D70"
            }
        }
    }

    Row {
        anchors.left: parent.left
        anchors.bottom: parent.bottom
        anchors.margins: 28
        spacing: 8

        Button {
            width: 94
            height: 38
            text: "Restart"
            background: Rectangle { radius: 12; color: parent.down ? "#4D17365C" : "#3317365C" }
            contentItem: Text { text: parent.text; color: "#AFC7E8"; horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter; font.pixelSize: 12 }
            onClicked: sddm.reboot()
        }

        Button {
            width: 94
            height: 38
            text: "Power off"
            background: Rectangle { radius: 12; color: parent.down ? "#4D17365C" : "#3317365C" }
            contentItem: Text { text: parent.text; color: "#AFC7E8"; horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter; font.pixelSize: 12 }
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
            root.errorMessage = "Incorrect username or password"
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
