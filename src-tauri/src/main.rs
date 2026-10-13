//! SchemaCraft desktop application.
//!
//! This crate is a thin adapter: it hosts the Tauri runtime and exposes core operations as
//! IPC commands. All domain logic lives in `schemacraft-core`.

// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod error;
mod logging;
mod state;

use std::process::ExitCode;

use tauri::Manager;

use state::AppState;

/// Name of the preferences file inside the per-user configuration directory.
const PREFERENCES_FILE_NAME: &str = "preferences.json";

fn main() -> ExitCode {
    logging::initialize();

    match run_application() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(%error, "SchemaCraft could not start");
            ExitCode::FAILURE
        }
    }
}

/// Builds the Tauri application and runs it until the last window closes.
fn run_application() -> tauri::Result<()> {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let package_info = app.package_info();
            tracing::info!(
                name = %package_info.name,
                version = %package_info.version,
                "application started"
            );
            let preferences_path = app.path().app_config_dir()?.join(PREFERENCES_FILE_NAME);
            app.manage(AppState::new(preferences_path));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info::get_app_info,
            commands::connection::test_connection,
            commands::connection::list_databases,
            commands::connection::list_schemas,
            commands::connection::inspect_database,
            commands::connection::cancel_inspection,
            commands::project::read_project,
            commands::project::write_project,
            commands::project::compute_schema_diff,
            commands::project::refresh_project_content,
            commands::preferences::read_preferences,
            commands::preferences::remember_connection,
            commands::preferences::forget_connection,
            commands::preferences::remember_project,
            commands::preferences::forget_project,
            commands::credentials::has_stored_password,
            commands::credentials::remember_password,
            commands::credentials::forget_password,
        ])
        .run(tauri::generate_context!())
}
