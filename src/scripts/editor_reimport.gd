@tool
extends EditorScript

var debug_mode := false

func _run():
    var args := OS.get_cmdline_args()
    debug_mode = "--debug-godot" in args

    var script_index := args.find("--script")
    if script_index == -1:
        _log_error("Could not find --script argument")
        _quit(1)
        return

    var operation_index := script_index + 2
    var params_index := script_index + 3

    if args.size() <= params_index:
        _log_error("Usage: godot --headless --editor --script editor_reimport.gd <operation> <json_params>")
        _log_error("Not enough command-line arguments provided.")
        _quit(1)
        return

    var operation := args[operation_index]
    var params_json := args[params_index]
    _log_info("Operation: %s" % operation)
    _log_debug("Params JSON: %s" % params_json)

    var json := JSON.new()
    var parse_error := json.parse(params_json)
    if parse_error != OK:
        _log_error("Failed to parse JSON parameters: %s" % params_json)
        _log_error("JSON Error: %s at line %d" % [json.get_error_message(), json.get_error_line()])
        _quit(1)
        return

    var params = json.get_data()
    if params == null:
        _log_error("Parsed parameters were null")
        _quit(1)
        return

    var result_code := OK
    match operation:
        "reimport_asset":
            result_code = _reimport_assets(params)
        _:
            _log_error("Unsupported editor operation: %s" % operation)
            result_code = ERR_UNAVAILABLE

    _quit(0 if result_code == OK else 1)

func _reimport_assets(params: Dictionary) -> int:
    var provided_paths: Array[String] = []

    if params.has("asset_paths"):
        var asset_paths_param = params.asset_paths
        if asset_paths_param is Array:
            for entry in asset_paths_param:
                if entry is String and not entry.strip_edges().is_empty():
                    provided_paths.append(entry.strip_edges())
        elif asset_paths_param is PackedStringArray:
            for i in range(asset_paths_param.size()):
                var entry: String = asset_paths_param[i]
                if not entry.strip_edges().is_empty():
                    provided_paths.append(entry.strip_edges())

    if params.has("asset_path") and params.asset_path is String and not params.asset_path.strip_edges().is_empty():
        provided_paths.append(params.asset_path.strip_edges())

    if provided_paths.is_empty():
        _log_error("No asset paths provided. Supply asset_path or asset_paths.")
        return ERR_INVALID_DATA

    var editor_interface := get_editor_interface()
    if editor_interface == null:
        _log_error("EditorInterface unavailable; ensure this runs within the Godot editor context.")
        return ERR_UNAVAILABLE

    var editor_fs: EditorFileSystem = editor_interface.get_resource_fs()
    if editor_fs == null:
        _log_error("EditorFileSystem unavailable; ensure Godot runs with --editor.")
        return ERR_UNAVAILABLE

    if editor_fs.is_scanning():
        _log_debug("EditorFileSystem is scanning. Waiting for completion before re-import...")
        var wait_time := 0
        while editor_fs.is_scanning() and wait_time < 20000:
            OS.delay_msec(100)
            wait_time += 100
        if editor_fs.is_scanning():
            _log_error("EditorFileSystem scanning did not finish within the timeout window.")
            return ERR_TIMEOUT

    var normalized_paths: Array[String] = []
    var missing_assets: Array[String] = []
    var to_reimport := PackedStringArray()

    for raw_path in provided_paths:
        var normalized := raw_path
        if not normalized.begins_with("res://"):
            normalized = "res://" + normalized
        normalized = normalized.strip_edges()
        if normalized == "res://":
            continue

        if not FileAccess.file_exists(normalized):
            missing_assets.append(normalized)
            continue

        normalized_paths.append(normalized)
        to_reimport.append(normalized)

    if normalized_paths.is_empty():
        _log_error("No valid assets found to re-import. Missing assets: %s" % str(missing_assets))
        return ERR_FILE_NOT_FOUND

    _log_debug("Assets scheduled for re-import: %s" % str(normalized_paths))
    editor_fs.reimport_files(to_reimport)

    var elapsed := 0
    while editor_fs.is_scanning() and elapsed < 60000:
        OS.delay_msec(100)
        elapsed += 100
    if editor_fs.is_scanning():
        _log_error("Asset re-import did not finish within the timeout window (60s).")
        return ERR_TIMEOUT

    editor_fs.scan()
    elapsed = 0
    while editor_fs.is_scanning() and elapsed < 20000:
        OS.delay_msec(100)
        elapsed += 100
    if editor_fs.is_scanning():
        _log_error("Filesystem rescan did not finish within the timeout window (20s).")
        return ERR_TIMEOUT

    _log_info("Assets re-imported successfully: %s" % str(normalized_paths))
    return OK

func _log_debug(message: String) -> void:
    if debug_mode:
        print("[DEBUG] " + message)

func _log_info(message: String) -> void:
    print("[INFO] " + message)

func _log_error(message: String) -> void:
    printerr("[ERROR] " + message)

func _quit(code: int) -> void:
    var editor_interface := get_editor_interface()
    if editor_interface != null:
        var tree: SceneTree = editor_interface.get_scene_tree()
        if tree != null:
            tree.quit(code)
            return

    var main_loop := Engine.get_main_loop()
    if main_loop is SceneTree:
        var scene_tree: SceneTree = main_loop
        scene_tree.quit(code)
        return
