use std::{collections::HashSet, ffi::c_void, mem::size_of, path::Path};

use napi_derive::napi;
use serde_json::{Value, json};
use windows::{
    Win32::{
        Foundation::{CloseHandle, HWND, LPARAM, RECT, TRUE},
        Graphics::Dwm::{DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS, DwmGetWindowAttribute},
        System::Threading::{
            OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
            QueryFullProcessImageNameW,
        },
        UI::WindowsAndMessaging::{
            EnumWindows, GW_OWNER, GWL_EXSTYLE, GetForegroundWindow, GetWindow, GetWindowLongW,
            GetWindowRect, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
            IsIconic, IsWindow, IsWindowVisible, SetForegroundWindow, WS_EX_TOOLWINDOW,
        },
    },
    core::{BOOL, PWSTR},
};

struct RunningApp {
    exe: String,
    title: String,
    pid: u32,
}

fn exe_basename(path: &str) -> Option<String> {
    let name = Path::new(path).file_name()?.to_str()?.trim();
    if name.is_empty() {
        return None;
    }
    Some(name.to_ascii_lowercase())
}

const fn is_excluded_system_exe(exe: &str) -> bool {
    matches!(
        exe.as_bytes(),
        b"explorer.exe"
            | b"textinputhost.exe"
            | b"applicationframehost.exe"
            | b"searchhost.exe"
            | b"shellexperiencehost.exe"
            | b"startmenuexperiencehost.exe"
            | b"lockapp.exe"
            | b"systemsettings.exe"
            | b"nvidia overlay.exe"
    )
}

#[expect(unsafe_code, reason = "Win32 GetWindowThreadProcessId is an FFI call")]
fn window_pid(hwnd: HWND) -> u32 {
    let mut pid = 0_u32;
    // SAFETY: `hwnd` is a window handle from Win32 and `pid` is a valid mutable stack pointer.
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&raw mut pid));
    }
    pid
}

#[expect(unsafe_code, reason = "Win32 GetWindowText APIs are FFI calls")]
fn window_title(hwnd: HWND) -> String {
    // SAFETY: `GetWindowTextLengthW` accepts any HWND and returns a non-negative character count.
    let len = unsafe { GetWindowTextLengthW(hwnd) };
    if len <= 0 {
        return String::new();
    }
    let Ok(buf_len) = usize::try_from(len).map(|n| n.saturating_add(1)) else {
        return String::new();
    };
    let mut buf = vec![0_u16; buf_len];
    // SAFETY: `buf` is a freshly allocated writable UTF-16 slice of length `buf_len`.
    let read = unsafe { GetWindowTextW(hwnd, &mut buf) };
    if read <= 0 {
        return String::new();
    }
    let Ok(end) = usize::try_from(read) else {
        return String::new();
    };
    String::from_utf16_lossy(buf.get(..end).unwrap_or(&[]))
}

#[expect(
    unsafe_code,
    reason = "Win32 OpenProcess and QueryFullProcessImageNameW require FFI"
)]
fn process_exe_name(pid: u32) -> Option<String> {
    if pid == 0 {
        return None;
    }
    // SAFETY: `OpenProcess` with `PROCESS_QUERY_LIMITED_INFORMATION` only opens a query handle.
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let mut buf = vec![0_u16; 1024];
    let mut size = u32::try_from(buf.len()).unwrap_or(1024);
    // SAFETY: `handle` is valid and `buf` holds `size` UTF-16 code units.
    let ok = unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &raw mut size,
        )
    }
    .is_ok();
    // SAFETY: `handle` was returned by `OpenProcess` above and is closed once here.
    let _ = unsafe { CloseHandle(handle) };
    if !ok {
        return None;
    }
    let len = usize::try_from(size).ok()?;
    let full = String::from_utf16_lossy(buf.get(..len)?);
    exe_basename(&full)
}

#[expect(unsafe_code, reason = "Win32 DwmGetWindowAttribute requires FFI")]
fn is_window_cloaked(hwnd: HWND) -> bool {
    let mut cloaked = 0_u32;
    let Ok(cb) = u32::try_from(size_of::<u32>()) else {
        return false;
    };
    // SAFETY: `cloaked` is a valid `u32` stack buffer of size `cb`.
    let ok = unsafe { DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, (&raw mut cloaked).cast(), cb) }
        .is_ok();
    ok && cloaked != 0
}

#[expect(
    unsafe_code,
    reason = "Win32 window bounds lookup requires DWM/User32 FFI"
)]
fn window_rect(hwnd: HWND) -> Option<RECT> {
    let mut rect = RECT::default();
    let Ok(cb) = u32::try_from(size_of::<RECT>()) else {
        return None;
    };
    // SAFETY: `rect` is a valid `RECT` stack buffer of size `cb`.
    let dwm_ok = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            (&raw mut rect).cast(),
            cb,
        )
    }
    .is_ok();
    if dwm_ok {
        return Some(rect);
    }
    // SAFETY: `rect` is a valid `RECT` stack buffer.
    unsafe { GetWindowRect(hwnd, &raw mut rect) }.ok()?;
    Some(rect)
}

struct EnumState {
    self_pid: u32,
    seen: HashSet<String>,
    apps: Vec<RunningApp>,
}

#[expect(
    unsafe_code,
    reason = "EnumWindows callback requires extern system signature and User32 FFI"
)]
unsafe extern "system" fn enum_window_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    // SAFETY: `lparam` points to `EnumState` kept alive on the stack for the duration of `EnumWindows`.
    let state = unsafe { &mut *(lparam.0 as *mut EnumState) };
    // SAFETY: `hwnd` is supplied by `EnumWindows`.
    if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
        return TRUE;
    }
    // SAFETY: `hwnd` is supplied by `EnumWindows`.
    if unsafe { GetWindow(hwnd, GW_OWNER) }.is_ok_and(|owner| !owner.0.is_null()) {
        return TRUE;
    }
    // SAFETY: `hwnd` is supplied by `EnumWindows`.
    let ex_style = unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) };
    #[expect(
        clippy::cast_possible_wrap,
        reason = "Win32 style flags are bitmasks in i32"
    )]
    let tool_window = WS_EX_TOOLWINDOW.0 as i32;
    if (ex_style & tool_window) != 0 || is_window_cloaked(hwnd) {
        return TRUE;
    }
    let title = window_title(hwnd);
    if title.is_empty() {
        return TRUE;
    }
    let pid = window_pid(hwnd);
    if pid == 0 || pid == state.self_pid {
        return TRUE;
    }
    let Some(exe) = process_exe_name(pid) else {
        return TRUE;
    };
    if is_excluded_system_exe(&exe) || !state.seen.insert(exe.clone()) {
        return TRUE;
    }
    state.apps.push(RunningApp { exe, title, pid });
    TRUE
}

#[napi]
pub(crate) fn list_overlay_apps() -> String {
    let mut state = EnumState {
        self_pid: std::process::id(),
        seen: HashSet::new(),
        apps: Vec::new(),
    };
    let ptr = (&raw mut state).cast::<c_void>() as isize;
    // SAFETY: `enum_window_proc` only accesses `state` synchronously during `EnumWindows`.
    #[expect(unsafe_code, reason = "Win32 EnumWindows requires FFI")]
    let _ = unsafe { EnumWindows(Some(enum_window_proc), LPARAM(ptr)) };
    state.apps.sort_by_key(|a| a.title.to_lowercase());
    let json_apps: Vec<Value> = state
        .apps
        .into_iter()
        .map(|app| json!({ "exe": app.exe, "title": app.title, "pid": app.pid }))
        .collect();
    Value::Array(json_apps).to_string()
}

#[napi]
pub(crate) fn get_foreground_window_info() -> Option<String> {
    // SAFETY: `GetForegroundWindow` takes no arguments and returns null or a window handle.
    #[expect(unsafe_code, reason = "Win32 GetForegroundWindow requires FFI")]
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return None;
    }
    let pid = window_pid(hwnd);
    let exe = process_exe_name(pid)?;
    let rect = window_rect(hwnd)?;
    // SAFETY: `hwnd` is the current foreground window handle.
    #[expect(unsafe_code, reason = "Win32 IsIconic requires FFI")]
    let minimized = unsafe { IsIconic(hwnd) }.as_bool();
    Some(
        json!({
            "hwnd": (hwnd.0 as isize).to_string(),
            "exe": exe,
            "title": window_title(hwnd),
            "pid": pid,
            "x": rect.left,
            "y": rect.top,
            "width": rect.right.saturating_sub(rect.left),
            "height": rect.bottom.saturating_sub(rect.top),
            "minimized": minimized,
        })
        .to_string(),
    )
}

#[napi]
pub(crate) fn focus_window(hwnd_str: String) -> bool {
    let parsed = hwnd_str.trim().parse::<isize>();
    drop(hwnd_str);
    let Ok(raw) = parsed else {
        return false;
    };
    if raw == 0 {
        return false;
    }
    let hwnd = HWND(raw as *mut c_void);
    // SAFETY: `IsWindow` safely validates whether `hwnd` still refers to an active window.
    #[expect(unsafe_code, reason = "Win32 IsWindow requires FFI")]
    if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
        return false;
    }
    // SAFETY: `hwnd` was validated by `IsWindow` immediately above.
    #[expect(unsafe_code, reason = "Win32 SetForegroundWindow requires FFI")]
    unsafe { SetForegroundWindow(hwnd) }.as_bool()
}

#[cfg(test)]
mod tests {
    use super::{exe_basename, is_excluded_system_exe};

    #[test]
    fn extracts_lowercase_exe_basename() {
        assert_eq!(
            exe_basename(r"C:\Program Files\Game\MyGame.EXE").as_deref(),
            Some("mygame.exe")
        );
        assert_eq!(exe_basename(""), None);
    }

    #[test]
    fn excludes_shell_processes() {
        assert!(is_excluded_system_exe("explorer.exe"));
        assert!(!is_excluded_system_exe("valorant-win64-shipping.exe"));
    }
}
