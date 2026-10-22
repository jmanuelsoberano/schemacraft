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
mod support;

use std::path::PathBuf;
use std::process::ExitCode;

use schemacraft_core::diagnostics::{self, StartupFailure, VersionNumber};
use tauri::Manager;

use state::AppState;

/// Name of the preferences file inside the per-user configuration directory.
const PREFERENCES_FILE_NAME: &str = "preferences.json";

/// Microsoft's page for the Evergreen WebView2 runtime.
const WEBVIEW2_DOWNLOAD_URL: &str = "https://developer.microsoft.com/microsoft-edge/webview2/";

/// Shown before any window exists, so it speaks both languages the application supports.
const MISSING_WEBVIEW2_MESSAGE: &str = "SchemaCraft needs the Microsoft Edge WebView2 Runtime, \
which is not installed on this computer. Open the download page now?\n\n\
SchemaCraft necesita Microsoft Edge WebView2 Runtime y no está instalado en este equipo. \
¿Abrir la página de descarga ahora?";

fn main() -> ExitCode {
    // The context carries the identifier, so the log folder is known, and the log open, before
    // anything can fail: the WebView2 check and the start of Tauri are logged too (ADR-041).
    let context = tauri::generate_context!();
    let log_directory = logging::initialize(&context.config().identifier);

    let Some(webview2) = webview_runtime_version() else {
        return ExitCode::FAILURE;
    };
    diagnostics::app_started(
        env!("CARGO_PKG_VERSION"),
        VersionNumber::parse(&webview2).as_ref(),
    );

    match run_application(context, log_directory) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(%error, "SchemaCraft could not start");
            diagnostics::startup_failed(StartupFailure::CouldNotStart);
            ExitCode::FAILURE
        }
    }
}

/// The version of the WebView2 runtime, when it can be loaded. The portable executable relies
/// on the Evergreen runtime that ships with Windows; when it is missing, a native dialog explains
/// it and offers to open the download page instead of leaving the user with a generic error.
fn webview_runtime_version() -> Option<String> {
    match tauri::webview_version() {
        Ok(version) => {
            tracing::debug!(%version, "WebView2 runtime found");
            Some(version)
        }
        Err(error) => {
            tracing::error!(%error, "WebView2 runtime not found");
            diagnostics::startup_failed(StartupFailure::WebView2Missing);
            let answer = rfd::MessageDialog::new()
                .set_level(rfd::MessageLevel::Warning)
                .set_title("SchemaCraft")
                .set_description(MISSING_WEBVIEW2_MESSAGE)
                .set_buttons(rfd::MessageButtons::YesNo)
                .show();
            if matches!(answer, rfd::MessageDialogResult::Yes)
                && let Err(error) = open::that_detached(WEBVIEW2_DOWNLOAD_URL)
            {
                tracing::error!(%error, "could not open the WebView2 download page");
            }
            None
        }
    }
}

/// Environment variable that opens a Chrome DevTools Protocol port on the webview, for automated
/// tests such as `scripts/smoke-test-release.mjs`. Unset for users; the port is local only.
const REMOTE_DEBUGGING_PORT_ENVIRONMENT_VARIABLE: &str = "SCHEMACRAFT_REMOTE_DEBUGGING_PORT";
/// Browser switches wry passes to WebView2 when nothing else is specified: they hide the mini
/// menu and the SmartScreen prompts. Setting any switch replaces them, so they are repeated here.
const DEFAULT_BROWSER_ARGUMENTS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

/// Creates the main window from the configuration (which does not create it automatically) so
/// that a test run can ask the webview for a remote debugging port before it starts.
fn create_main_window(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let window_config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .ok_or("the main window is missing from tauri.conf.json")?;
    let mut builder = tauri::WebviewWindowBuilder::from_config(app.handle(), window_config)?;
    if let Some(port) = remote_debugging_port() {
        tracing::warn!(port, "remote debugging requested through the environment");
        builder = builder.additional_browser_args(&format!(
            "{DEFAULT_BROWSER_ARGUMENTS} --remote-debugging-port={port}"
        ));
    }
    builder.build()?;
    Ok(())
}

/// The remote debugging port requested by the environment, if any and valid.
fn remote_debugging_port() -> Option<u16> {
    let value = std::env::var(REMOTE_DEBUGGING_PORT_ENVIRONMENT_VARIABLE).ok()?;
    match value.trim().parse::<u16>() {
        Ok(port) if port > 0 => Some(port),
        _ => {
            tracing::warn!(
                value,
                "ignoring an invalid {REMOTE_DEBUGGING_PORT_ENVIRONMENT_VARIABLE}"
            );
            None
        }
    }
}

/// Builds the Tauri application and runs it until the last window closes. `log_directory` is
/// the folder logging writes to, for the about dialog.
fn run_application(context: tauri::Context, log_directory: Option<PathBuf>) -> tauri::Result<()> {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let preferences_path = app.path().app_config_dir()?.join(PREFERENCES_FILE_NAME);
            app.manage(AppState::new(preferences_path, log_directory));
            create_main_window(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info::get_app_info,
            commands::connection::test_connection,
            commands::connection::list_databases,
            commands::connection::describe_database,
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
            commands::export::export_diagram,
            commands::export::cancel_export,
            commands::diagnostics::open_log_folder,
            commands::support::read_diagnostic_report,
            commands::support::write_diagnostic_report,
            commands::support::open_support_page,
        ])
        .run(context)
}
