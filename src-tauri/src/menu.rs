//! Native (global) menu bar — macOS only.
//!
//! On macOS the app installs a real global menu so it behaves like a native
//! application. Windows and Linux keep the in-window `MenuBar.tsx`.
//!
//! Three things to know:
//! 1. We do NOT start from `Menu::default` and append — that would duplicate
//!    the File/Edit/View/Help submenus it already provides. Instead we build
//!    the whole bar ourselves from a single root `Menu::new`.
//! 2. Labels are localized by reusing the frontend's locale JSON (embedded
//!    here via include_str!), so switching language rebuilds the menu.
//! 3. App-defined items carry `oar:<id>` ids; `on_menu_event` (lib.rs) emits
//!    them to the frontend. Predefined items (Cut/Copy/Paste/Quit/…) are
//!    handled by the OS and emit nothing.

use std::collections::HashMap;
use std::sync::OnceLock;

use serde::Deserialize;
use tauri::menu::{
    CheckMenuItem, IsMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu,
};
use tauri::{AppHandle, Wry};

const ZH_JSON: &str = include_str!("../../src/locales/zh-CN.json");
const EN_JSON: &str = include_str!("../../src/locales/en-US.json");

// The seven view-toggle keys ("oar:view:<key>") are built into the View
// submenu below. Keep them in sync with VIEW_KEYS in src/types.ts and
// DEFAULT_VIEW in src/store.ts — there's no shared cross-language definition.

/// Cached parsed locale tables. `tr()` is called ~45× per menu rebuild, and
/// re-parsing the whole locale JSON each time is wasteful; parse once.
fn locale_table(locale: &str) -> &'static HashMap<&'static str, String> {
    static ZH: OnceLock<HashMap<&'static str, String>> = OnceLock::new();
    static EN: OnceLock<HashMap<&'static str, String>> = OnceLock::new();
    match locale {
        "en-US" => EN.get_or_init(|| serde_json::from_str(EN_JSON).unwrap_or_default()),
        _ => ZH.get_or_init(|| serde_json::from_str(ZH_JSON).unwrap_or_default()),
    }
}

/// Look up a localized menu label. Falls back to the key (and then English) so
/// a missing translation never produces an empty string in the menu.
fn tr(locale: &str, key: &str) -> String {
    locale_table(locale)
        .get(key)
        .cloned()
        .or_else(|| locale_table("en-US").get(key).cloned())
        .unwrap_or_else(|| key.to_string())
}

/// The view-checkbox state the frontend sends when (re)building the menu, so
/// CheckMenuItems are created with their real checked value instead of a
/// hardcoded `true` (which made hidden panels show as checked on every
/// rebuild). Missing/unknown keys default to true (the original behavior).
#[derive(Default, Deserialize)]
pub struct ViewState {
    #[serde(default)]
    pub view: HashMap<String, bool>,
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub ocr_model: Option<String>,
    #[serde(default)]
    pub layout_model: Option<String>,
    #[serde(default)]
    pub formula_model: Option<String>,
    #[serde(default)]
    pub table_model: Option<String>,
    #[serde(default)]
    pub device: Option<String>,
}

impl ViewState {
    /// Checked state for a view item id, defaulting to true.
    fn checked(&self, item_id: &str) -> bool {
        // item_id looks like "oar:view:fileList"; the view key is the suffix.
        self.view
            .get(item_id.trim_start_matches("oar:view:"))
            .copied()
            .unwrap_or(true)
    }

    fn theme_checked(&self, theme: &str) -> bool {
        self.theme.as_deref().unwrap_or("system") == theme
    }

    fn model_checked(&self, kind: &str, key: &str) -> bool {
        match kind {
            "ocr" => self.ocr_model.as_deref() == Some(key),
            "layout" => self.layout_model.as_deref() == Some(key),
            "formula" => self.formula_model.as_deref() == Some(key),
            "table" => self.table_model.as_deref() == Some(key),
            _ => false,
        }
    }

    fn device_checked(&self, device: &str) -> bool {
        self.device.as_deref().unwrap_or("auto") == device
    }
}

/// Build and install the native menu for the given locale (macOS only). Safe
/// to call again to switch language — it replaces the previous menu. `state`
/// seeds the View checkbox items with their real checked value so a rebuild
/// never resets hidden panels to checked.
#[cfg(target_os = "macos")]
pub fn rebuild(app: &AppHandle, locale: &str, state: &ViewState) {
    match build(app, locale, state) {
        Ok(menu) => {
            let _ = app.set_menu(menu);
        }
        Err(e) => eprintln!("failed to build native menu: {e}"),
    }
}

/// No-op off-macOS: the in-window MenuBar.tsx is the UI there.
#[cfg(not(target_os = "macos"))]
pub fn rebuild(_app: &AppHandle, _locale: &str, _state: &ViewState) {}

#[cfg(target_os = "macos")]
fn build(app: &AppHandle, locale: &str, state: &ViewState) -> tauri::Result<Menu<Wry>> {
    let pkg = app.package_info().clone();
    let about_md = tauri::menu::AboutMetadata {
        name: Some(pkg.name.clone()),
        version: Some(pkg.version.to_string()),
        ..Default::default()
    };

    // The macOS App menu (bold app name) — must be first.
    let app_menu = Submenu::with_items(
        app,
        &pkg.name,
        true,
        &[
            &PredefinedMenuItem::about(app, None, Some(about_md))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let file = Submenu::with_items(
        app,
        tr(locale, "menu.file"),
        true,
        &[
            &MenuItem::with_id(
                app,
                "oar:open-folder",
                tr(locale, "menu.file.importFolder"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "oar:import-images",
                tr(locale, "menu.file.importImages"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "oar:import-pdf",
                tr(locale, "menu.file.importPdf"),
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "oar:save",
                tr(locale, "menu.file.save"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "oar:save-and-next",
                tr(locale, "menu.file.saveAndNext"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "oar:export",
                tr(locale, "menu.file.export"),
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let edit = Submenu::with_items(
        app,
        tr(locale, "menu.edit"),
        true,
        &[
            // App-semantic actions: these emit `oar:*` events (handled in
            // useNativeMenu.ts) so Undo/Redo/Copy/Paste go through the store
            // just like the in-window MenuBar on other platforms.
            //
            // No accelerators (Cmd+Z/…): if we set them, macOS would intercept
            // those keys before useShortcuts.ts, double-firing on the canvas
            // and breaking native text editing in inputs. Without accelerators
            // clicking the menu item still triggers the action, and the
            // keyboard path keeps working via useShortcuts.ts (which already
            // bails out of text fields).
            &MenuItem::with_id(
                app,
                "oar:undo",
                tr(locale, "menu.edit.undo"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "oar:redo",
                tr(locale, "menu.edit.redo"),
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "oar:copy",
                tr(locale, "menu.edit.copy"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "oar:paste",
                tr(locale, "menu.edit.paste"),
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "oar:select-all",
                tr(locale, "menu.edit.selectAll"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "oar:clear-sel",
                tr(locale, "menu.edit.clearSelection"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "oar:delete",
                tr(locale, "menu.edit.deleteSelected"),
                true,
                None::<&str>,
            )?,
        ],
    )?;

    let view = Submenu::with_items(
        app,
        tr(locale, "menu.view"),
        true,
        &[
            // No accelerators on zoom/actual: macOS would dispatch them AND
            // useShortcuts.ts would too (double-fire). Keyboard stays in the
            // JS keydown layer as the single source of truth.
            &MenuItem::with_id(
                app,
                "oar:zoom-in",
                tr(locale, "menu.view.zoomIn"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "oar:zoom-out",
                tr(locale, "menu.view.zoomOut"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "oar:actual",
                tr(locale, "menu.view.actual"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "oar:fit-window",
                tr(locale, "menu.view.fitWindow"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "oar:fit-width",
                tr(locale, "menu.view.fitWidth"),
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            // Seed each checkbox with its real checked state from the frontend
            // (state.checked defaults to true for unknown keys). Previously
            // these were hardcoded true, so hidden panels showed as checked on
            // every rebuild (startup, locale change, model-option change).
            &CheckMenuItem::with_id(
                app,
                "oar:view:fileList",
                tr(locale, "menu.view.showFileList"),
                true,
                state.checked("oar:view:fileList"),
                None::<&str>,
            )?,
            &CheckMenuItem::with_id(
                app,
                "oar:view:results",
                tr(locale, "menu.view.showResults"),
                true,
                state.checked("oar:view:results"),
                None::<&str>,
            )?,
            &CheckMenuItem::with_id(
                app,
                "oar:view:toolbar",
                tr(locale, "menu.view.showToolbar"),
                true,
                state.checked("oar:view:toolbar"),
                None::<&str>,
            )?,
            &CheckMenuItem::with_id(
                app,
                "oar:view:statusBar",
                tr(locale, "menu.view.showStatusBar"),
                true,
                state.checked("oar:view:statusBar"),
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &CheckMenuItem::with_id(
                app,
                "oar:view:boxes",
                tr(locale, "menu.view.showBoxes"),
                true,
                state.checked("oar:view:boxes"),
                None::<&str>,
            )?,
            &CheckMenuItem::with_id(
                app,
                "oar:view:labels",
                tr(locale, "menu.view.showLabels"),
                true,
                state.checked("oar:view:labels"),
                None::<&str>,
            )?,
            &CheckMenuItem::with_id(
                app,
                "oar:view:highlight",
                tr(locale, "menu.view.highlight"),
                true,
                state.checked("oar:view:highlight"),
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &Submenu::with_items(
                app,
                tr(locale, "menu.view.theme"),
                true,
                &[
                    &CheckMenuItem::with_id(
                        app,
                        "oar:theme:light",
                        tr(locale, "theme.light"),
                        true,
                        state.theme_checked("light"),
                        None::<&str>,
                    )?,
                    &CheckMenuItem::with_id(
                        app,
                        "oar:theme:dark",
                        tr(locale, "theme.dark"),
                        true,
                        state.theme_checked("dark"),
                        None::<&str>,
                    )?,
                    &CheckMenuItem::with_id(
                        app,
                        "oar:theme:system",
                        tr(locale, "theme.system"),
                        true,
                        state.theme_checked("system"),
                        None::<&str>,
                    )?,
                ],
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "oar:reset-layout",
                tr(locale, "menu.view.resetLayout"),
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    // Model menu — only if the catalog loaded.
    let model = build_model_menu(app, locale, state);

    let help = Submenu::with_items(
        app,
        tr(locale, "menu.help"),
        true,
        &[
            &Submenu::with_items(
                app,
                tr(locale, "menu.language"),
                true,
                &[
                    &CheckMenuItem::with_id(
                        app,
                        "oar:lang:zh-CN",
                        tr(locale, "locale.zh-CN"),
                        true,
                        locale == "zh-CN",
                        None::<&str>,
                    )?,
                    &CheckMenuItem::with_id(
                        app,
                        "oar:lang:en-US",
                        tr(locale, "locale.en-US"),
                        true,
                        locale == "en-US",
                        None::<&str>,
                    )?,
                ],
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "oar:help:docs",
                tr(locale, "menu.help.docs"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "oar:help:faq",
                tr(locale, "menu.help.faq"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "oar:help:feedback",
                tr(locale, "menu.help.feedback"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "oar:help:update",
                tr(locale, "menu.help.update"),
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "oar:shortcuts",
                tr(locale, "menu.help.shortcuts"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "oar:about",
                tr(locale, "menu.help.about"),
                true,
                None::<&str>,
            )?,
        ],
    )?;

    // Assemble. On macOS the first submenu becomes the bold app-name menu.
    let mut top: Vec<Box<dyn IsMenuItem<Wry>>> = vec![
        Box::new(app_menu),
        Box::new(file),
        Box::new(edit),
        Box::new(view),
    ];
    if let Some(m) = model {
        top.push(Box::new(m));
    }
    top.push(Box::new(help));
    let refs: Vec<&dyn IsMenuItem<Wry>> = top.iter().map(|b| b.as_ref()).collect();
    Menu::with_items(app, &refs)
}

#[cfg(target_os = "macos")]
fn build_model_menu(app: &AppHandle, locale: &str, state: &ViewState) -> Option<Submenu<Wry>> {
    let opts = crate::models::options(app).ok()?;
    let ocr = model_radio_submenu(
        app,
        &tr(locale, "menu.model.ocr"),
        "ocr",
        &opts.ocr_profiles,
        state,
    )?;
    let layout = model_radio_submenu(
        app,
        &tr(locale, "menu.model.layout"),
        "layout",
        &opts.layout_models,
        state,
    )?;
    let formula = model_radio_submenu(
        app,
        &tr(locale, "menu.model.formulaRecognition"),
        "formula",
        &opts.formula_profiles,
        state,
    )?;
    let table = model_radio_submenu(
        app,
        &tr(locale, "menu.model.tableRecognition"),
        "table",
        &opts.table_profiles,
        state,
    )?;
    let device = Submenu::with_items(
        app,
        tr(locale, "menu.model.device"),
        true,
        &[
            &CheckMenuItem::with_id(
                app,
                "oar:device:auto",
                "Auto",
                true,
                state.device_checked("auto"),
                None::<&str>,
            )
            .ok()?,
            &CheckMenuItem::with_id(
                app,
                "oar:device:cpu",
                "CPU",
                true,
                state.device_checked("cpu"),
                None::<&str>,
            )
            .ok()?,
            &CheckMenuItem::with_id(
                app,
                "oar:device:cuda",
                "CUDA",
                true,
                state.device_checked("cuda"),
                None::<&str>,
            )
            .ok()?,
        ],
    )
    .ok()?;

    Submenu::with_items(
        app,
        tr(locale, "menu.model"),
        true,
        &[
            &ocr,
            &layout,
            &formula,
            &table,
            &PredefinedMenuItem::separator(app).ok()?,
            &device,
            &PredefinedMenuItem::separator(app).ok()?,
            &MenuItem::with_id(
                app,
                "oar:preannotate-current",
                tr(locale, "menu.model.preannotateCurrent"),
                true,
                None::<&str>,
            )
            .ok()?,
            &MenuItem::with_id(
                app,
                "oar:preannotate-all",
                tr(locale, "menu.model.preannotateAll"),
                true,
                None::<&str>,
            )
            .ok()?,
            &PredefinedMenuItem::separator(app).ok()?,
            &MenuItem::with_id(
                app,
                "oar:settings",
                tr(locale, "menu.model.settings"),
                true,
                None::<&str>,
            )
            .ok()?,
        ],
    )
    .ok()
}

#[cfg(target_os = "macos")]
fn model_radio_submenu(
    app: &AppHandle,
    title: &str,
    kind: &str,
    options: &[crate::models::ModelOption],
    state: &ViewState,
) -> Option<Submenu<Wry>> {
    let items: Vec<CheckMenuItem<Wry>> = options
        .iter()
        .filter_map(|o| {
            CheckMenuItem::with_id(
                app,
                format!("oar:model:{kind}:{}", o.key),
                &o.title,
                true,
                state.model_checked(kind, &o.key),
                None::<&str>,
            )
            .ok()
        })
        .collect();
    let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect();
    Submenu::with_items(app, title, true, &refs).ok()
}

#[cfg(target_os = "macos")]
pub fn set_checked(app: &AppHandle, item_id: &str, checked: bool) {
    let Some(top) = app.menu() else { return };
    if let Some(item) = find_check_item(top.items().unwrap_or_default(), item_id) {
        let _ = item.set_checked(checked);
    }
}

#[cfg(target_os = "macos")]
fn find_check_item(items: Vec<MenuItemKind<Wry>>, item_id: &str) -> Option<CheckMenuItem<Wry>> {
    for item in items {
        match item {
            MenuItemKind::Check(check) if check.id() == &item_id => return Some(check),
            MenuItemKind::Submenu(submenu) => {
                if let Some(found) = find_check_item(submenu.items().unwrap_or_default(), item_id) {
                    return Some(found);
                }
            }
            _ => {}
        }
    }
    None
}

#[cfg(target_os = "macos")]
pub fn set_theme_checked(app: &AppHandle, selected: &str) {
    for theme in ["light", "dark", "system"] {
        set_checked(app, &format!("oar:theme:{theme}"), theme == selected);
    }
}

#[cfg(not(target_os = "macos"))]
pub fn set_theme_checked(_app: &AppHandle, _selected: &str) {}
