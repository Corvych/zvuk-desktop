// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    zvuk_desktop_lib::apply_cache_browser_args();
    zvuk_desktop_lib::run()
}

