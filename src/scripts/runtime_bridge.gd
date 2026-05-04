extends Node
class_name GodotMcpRuntimeBridge

const BRIDGE_VERSION := "__PACKAGE_VERSION__"
const MCP_HOST := "127.0.0.1"

var _client := StreamPeerTCP.new()
var _receive_buffer := ""
var _port := 0
var _token := ""
var _session_id := ""
var _hello_sent := false

func _ready() -> void:
    _read_launch_configuration()
    if _port <= 0 or _token.is_empty() or _session_id.is_empty():
        return
    set_process(true)
    _connect_to_server()

func _process(_delta: float) -> void:
    if _port <= 0:
        return

    _client.poll()

    if _client.get_status() == StreamPeerTCP.STATUS_CONNECTED:
        if not _hello_sent:
            _send_hello()
            _hello_sent = true
        _read_messages()

func _connect_to_server() -> void:
    var error := _client.connect_to_host(MCP_HOST, _port)
    if error != OK:
        push_warning("Godot MCP runtime bridge failed to connect: %s" % error_string(error))

func _read_launch_configuration() -> void:
    var args := OS.get_cmdline_user_args()
    var index := 0

    while index < args.size():
        var argument: String = args[index]
        match argument:
            "--godot-mcp-port":
                if index + 1 < args.size():
                    _port = int(args[index + 1])
                    index += 1
            "--godot-mcp-token":
                if index + 1 < args.size():
                    _token = args[index + 1]
                    index += 1
            "--godot-mcp-session":
                if index + 1 < args.size():
                    _session_id = args[index + 1]
                    index += 1
        index += 1

func _send_hello() -> void:
    var scene_path := _get_current_scene_path()
    _send_message({
        "command": "hello",
        "token": _token,
        "version": BRIDGE_VERSION,
        "sessionId": _session_id,
        "projectPath": ProjectSettings.globalize_path("res://"),
        "scenePath": scene_path if not scene_path.is_empty() else null,
    })

func _send_message(message: Dictionary) -> void:
    if _client.get_status() != StreamPeerTCP.STATUS_CONNECTED:
        return

    var payload := JSON.stringify(message) + "\n"
    _client.put_data(payload.to_utf8_buffer())

func _read_messages() -> void:
    var available_bytes := _client.get_available_bytes()
    if available_bytes <= 0:
        return

    _receive_buffer += _client.get_utf8_string(available_bytes)
    var newline_index := _receive_buffer.find("\n")

    while newline_index != -1:
        var raw_message := _receive_buffer.substr(0, newline_index).strip_edges()
        _receive_buffer = _receive_buffer.substr(newline_index + 1)

        if not raw_message.is_empty():
            _handle_raw_message(raw_message)

        newline_index = _receive_buffer.find("\n")

func _handle_raw_message(raw_message: String) -> void:
    var parsed := JSON.parse_string(raw_message)
    if typeof(parsed) != TYPE_DICTIONARY:
        _send_message({"ok": false, "error": "Invalid message"})
        return

    var message := parsed as Dictionary
    var response := _handle_command(message)
    if message.has("requestId"):
        response["requestId"] = message["requestId"]
    _send_message(response)

func _handle_command(message: Dictionary) -> Dictionary:
    match message.get("command", ""):
        "find_node":
            return _find_node(message.get("nodePath", ""))
        "change_scene":
            return _change_scene(message.get("scenePath", ""))
        "invoke_node_action":
            return _invoke_node_action(message.get("nodePath", ""), message.get("action", ""))
        _:
            return {"ok": false, "error": "Unsupported command"}

func _find_node(node_path: String) -> Dictionary:
    var node := get_node_or_null(NodePath(node_path))
    if node == null:
        return {"ok": false, "error": "Node not found"}

    return {
        "ok": true,
        "result": {
            "found": true,
            "nodePath": node_path,
            "nodeType": node.get_class(),
        }
    }

func _change_scene(scene_path: String) -> Dictionary:
    if scene_path.is_empty():
        return {"ok": false, "error": "Scene path is required"}

    var error := get_tree().change_scene_to_file(scene_path)
    if error != OK:
        return {"ok": false, "error": error_string(error)}

    return {
        "ok": true,
        "result": {
            "scenePath": scene_path,
        }
    }

func _invoke_node_action(node_path: String, action: String) -> Dictionary:
    var node := get_node_or_null(NodePath(node_path))
    if node == null:
        return {"ok": false, "error": "Node not found"}

    if node is BaseButton and action == "press":
        node.emit_signal("pressed")
        return {
            "ok": true,
            "result": {
                "nodePath": node_path,
                "action": action,
            }
        }

    var supported_actions: Array = []
    if node is BaseButton:
        supported_actions = ["press"]

    return {
        "ok": false,
        "error": "Unsupported action",
        "supportedActions": supported_actions,
    }

func _get_current_scene_path() -> String:
    var current_scene := get_tree().current_scene
    if current_scene == null:
        return ""
    return current_scene.scene_file_path
