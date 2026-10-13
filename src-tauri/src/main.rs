//! SchemaCraft desktop application.
//!
//! This crate is a thin adapter: it hosts the Tauri runtime and exposes core operations as
//! IPC commands. All domain logic lives in `schemacraft-core`.

// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod logging;

use std::process::ExitCode;

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
        .setup(|app| {
            let package_info = app.package_info();
            tracing::info!(
                name = %package_info.name,
                version = %package_info.version,
                "application started"
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::app_info::get_app_info])
        .run(tauri::generate_context!())
}
