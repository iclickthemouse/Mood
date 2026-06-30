// mood desktop shell. The HTTP plugin lets the web frontend make model API
// calls (cloud or local) through the native networking stack, which avoids
// the browser CORS / mixed-content restrictions that otherwise block calls
// to http://localhost model servers from the webview.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .run(tauri::generate_context!())
        .expect("error while running mood");
}
