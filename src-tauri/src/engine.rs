use std::collections::HashMap;
use std::env;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::{Emitter, State};

use crate::paths;

pub struct EngineState {
    pub jobs: Arc<Mutex<HashMap<String, Child>>>,
    pub python: PathBuf,
    pub python_args: Vec<String>,
    pub engine_dir: PathBuf,
}

impl EngineState {
    pub fn discover() -> Self {
        let root = paths::project_root().unwrap_or_else(|| PathBuf::from(".."));
        let engine_dir = root.join("engine");
        let python = env::var_os("FONTYPE_PYTHON")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                let venv = if cfg!(windows) {
                    engine_dir.join(".venv/Scripts/python.exe")
                } else {
                    engine_dir.join(".venv/bin/python")
                };
                if venv.is_file() {
                    venv
                } else if cfg!(windows) {
                    PathBuf::from("py")
                } else {
                    PathBuf::from("python3")
                }
            });
        let python_args = if python.file_name().and_then(|n| n.to_str()) == Some("py") {
            vec!["-3.12".into(), "-m".into(), "fontype_engine".into()]
        } else {
            vec!["-m".into(), "fontype_engine".into()]
        };
        Self {
            jobs: Arc::new(Mutex::new(HashMap::new())),
            python,
            python_args,
            engine_dir,
        }
    }
}

#[tauri::command]
pub fn engine_info(state: State<'_, EngineState>) -> Value {
    json!({
        "python": state.python.to_string_lossy(),
        "engineDir": state.engine_dir.to_string_lossy(),
        "pythonArgs": state.python_args,
    })
}

#[tauri::command]
pub fn engine_request(
    job_id: String,
    cmd: String,
    params: Value,
    state: State<'_, EngineState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if job_id.trim().is_empty() {
        return Err("معرّف المهمة فارغ.".into());
    }
    {
        let jobs = state.jobs.lock().map_err(|e| e.to_string())?;
        if jobs.contains_key(&job_id) {
            return Err("توجد مهمة جارية بنفس المعرّف.".into());
        }
    }

    let request = serde_json::to_string(&json!({
        "id": job_id,
        "cmd": cmd,
        "params": params,
    }))
    .map_err(|e| e.to_string())?;

    let mut command = Command::new(&state.python);
    command
        .args(&state.python_args)
        .env("PYTHONPATH", &state.engine_dir)
        .env("PYTHONIOENCODING", "utf-8")
        .current_dir(&state.engine_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|e| {
        format!("تعذّر تشغيل محرك الخطوط ({e}). تأكد من وجود engine/.venv وتثبيت تبعيات Python.")
    })?;
    let stdout = child.stdout.take().ok_or("لا يمكن قراءة مخرجات المحرك.")?;
    let stderr = child.stderr.take().ok_or("لا يمكن قراءة سجل المحرك.")?;

    let jobs = state.jobs.clone();
    let app_out = app.clone();
    let stdout_job = job_id.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let mut value: Value = serde_json::from_str(&line).unwrap_or_else(
                |_| json!({"type": "log", "data": {"lines": [line], "stream": "stdout"}}),
            );
            if let Some(object) = value.as_object_mut() {
                object.insert("jobId".into(), json!(stdout_job));
            }
            let _ = app_out.emit("engine-event", value);
        }
        if let Ok(mut map) = jobs.lock() {
            map.remove(&stdout_job);
        }
    });

    let app_err = app.clone();
    let stderr_job = job_id.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            let _ = app_err.emit(
                "engine-event",
                json!({
                    "jobId": stderr_job,
                    "type": "log",
                    "data": {"lines": [line], "stream": "stderr"}
                }),
            );
        }
    });

    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or("لا يمكن إرسال الطلب إلى المحرك.")?;
        stdin
            .write_all(format!("{request}\n").as_bytes())
            .and_then(|_| stdin.flush())
            .map_err(|e| format!("تعذّر إرسال الطلب إلى المحرك: {e}"))?;
    }

    state
        .jobs
        .lock()
        .map_err(|e| e.to_string())?
        .insert(job_id, child);
    Ok(())
}

#[tauri::command]
pub fn engine_cancel(job_id: String, state: State<'_, EngineState>) -> Result<bool, String> {
    let mut jobs = state.jobs.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = jobs.remove(&job_id) {
        let _ = child.kill();
        Ok(true)
    } else {
        Ok(false)
    }
}
