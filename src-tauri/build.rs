fn main() {
    // Read version from package.json (single source of truth)
    let pkg = std::fs::read_to_string("../package.json")
        .expect("Failed to read ../package.json");
    let json: serde_json::Value = serde_json::from_str(&pkg)
        .expect("Failed to parse ../package.json");
    let pkg_version = json["version"]
        .as_str()
        .expect("No 'version' field in package.json");
    let cargo_version = env!("CARGO_PKG_VERSION");

    if pkg_version != cargo_version {
        panic!(
            "\n\n[VERSION MISMATCH] package.json has version \"{pkg_version}\" \
             but Cargo.toml has \"{cargo_version}\".\n\
             Run `node scripts/set-version.mjs <new-version>` to sync all files.\n"
        );
    }

    // Re-run if package.json changes
    println!("cargo:rerun-if-changed=../package.json");
    println!("cargo:rerun-if-changed=../src-tauri/Cargo.toml");

    tauri_build::build()
}
