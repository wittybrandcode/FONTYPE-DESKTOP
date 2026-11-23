import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../core/api";
import type { ProjectHandle } from "../core/types";

interface Props {
  project: ProjectHandle | null;
  onProject: (handle: ProjectHandle | null) => void;
  onNotice: (text: string, kind?: "ok" | "error") => void;
}

export default function ProjectPanel({ project, onProject, onNotice }: Props) {
  const [name, setName] = useState("");
  const [family, setFamily] = useState("");
  const [style, setStyle] = useState("Regular");
  const [upm, setUpm] = useState(1000);

  async function createProject() {
    try {
      const parent = await open({
        directory: true,
        multiple: false,
        title: "اختر المجلد الذي سيحتوي المشروع",
      });
      if (typeof parent !== "string") return;
      const handle = await api.createProject({ parent, name, family, style, upm });
      onProject(handle);
      onNotice("تم إنشاء المشروع وحفظه بصيغة .afsp", "ok");
    } catch (error) {
      onNotice(String(error), "error");
    }
  }

  async function openProject() {
    try {
      const path = await open({
        directory: true,
        multiple: false,
        title: "اختر مجلد المشروع (.afsp)",
      });
      if (typeof path !== "string") return;
      const handle = await api.openProject(path);
      onProject(handle);
      onNotice("تم فتح المشروع", "ok");
      if (handle.migrationNotes.length > 0) {
        onNotice(handle.migrationNotes.join(" · "), "ok");
      }
    } catch (error) {
      onNotice(String(error), "error");
    }
  }

  async function saveProject() {
    if (!project) return;
    try {
      await api.saveProject(project.path, project.project);
      onNotice("تم حفظ المشروع", "ok");
    } catch (error) {
      onNotice(String(error), "error");
    }
  }

  return (
    <div className="panel">
      <h2>المشروع</h2>
      <p className="hint">كل مشروع مجلد قابل للنقل بصيغة <code>.afsp</code>.</p>

      <label>اسم المشروع</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: خط الربيع" />

      <label>اسم العائلة</label>
      <input value={family} onChange={(e) => setFamily(e.target.value)} placeholder="Arabic Spring" />

      <label>النمط</label>
      <input value={style} onChange={(e) => setStyle(e.target.value)} />

      <label>وحدات لكل Em (UPM)</label>
      <select value={upm} onChange={(e) => setUpm(Number(e.target.value))}>
        <option value={1000}>1000 — الافتراضي</option>
        <option value={2048}>2048</option>
      </select>

      <div className="button-row">
        <button className="primary" onClick={createProject} disabled={!name.trim()}>
          إنشاء مشروع
        </button>
        <button onClick={openProject}>فتح</button>
        <button onClick={saveProject} disabled={!project}>
          حفظ
        </button>
      </div>

      {project ? (
        <div className="project-card">
          <div className="project-card-title">{project.project.font.familyName}</div>
          <dl>
            <div><dt>المسار</dt><dd className="path">{project.path}</dd></div>
            <div><dt>المخطط</dt><dd>{project.project.schemaVersion}</dd></div>
            <div><dt>UPM</dt><dd>{project.project.font.unitsPerEm}</dd></div>
            <div><dt>الخانات</dt><dd>{project.project.glyphSlots.length}</dd></div>
          </dl>
        </div>
      ) : (
        <div className="empty-card">لا يوجد مشروع مفتوح حالياً.</div>
      )}
    </div>
  );
}
