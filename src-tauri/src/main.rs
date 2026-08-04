// Κρύβει το μαύρο παράθυρο κονσόλας στα Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mila_lib::run()
}
