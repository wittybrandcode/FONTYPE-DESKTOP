mod anchors;
mod contracts;
mod engine;
mod import;
mod inventory;
mod paths;
mod project;
mod workspace;

use engine::EngineState;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(EngineState::discover())
        .invoke_handler(tauri::generate_handler![
            project::create_project,
            project::open_project,
            project::save_project,
            project::set_shaping_options,
            project::record_build,
            project::backup_project,
            project::restore_project,
            inventory::preset_info,
            inventory::generate_inventory,
            import::import_svg,
            import::set_preview_path,
            import::remove_artwork,
            import::approve_slot,
            import::set_slot_metrics,
            workspace::set_placement,
            workspace::set_metrics,
            workspace::set_workspace_prefs,
            workspace::set_guides,
            anchors::anchor_suggestions,
            anchors::apply_anchor_preset,
            anchors::set_anchors,
            engine::engine_info,
            engine::engine_request,
            engine::engine_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FONTYPE");
}
