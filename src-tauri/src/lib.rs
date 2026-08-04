#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Ανοίγει εξωτερικούς συνδέσμους στον κανονικό browser του χρήστη
        // αντί μέσα στο παράθυρο του app.
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running Mila");
}
