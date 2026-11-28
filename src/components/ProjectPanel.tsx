import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../core/api";
import type { ProjectHandle } from "../core/types";
import { PanelHeader, SectionLabel } from "../ui/components";
import { Icon } from "../ui/icons";

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
  const [version, setVersion] = useState("1.000");
  const [designer, setDesigner] = useState("");
  const [copyright, setCopyright] = useState("");
  const [license, setLicense] = useState("");

  useEffect(() => {
    if (!project) return;
    setVersion(project.project.font.version);
    setDesigner(project.project.font.designer);
    setCopyright(project.project.font.copyright);
    setLicense(project.project.font.license);
  }, [project]);

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

  async function saveExportMetadata() {
    if (!project) return;
    const updated: ProjectHandle = {
      ...project,
      project: {
        ...project.project,
        font: {
          ...project.project.font,
          version: version.trim() || "1.000",
          designer: designer.trim(),
          copyright: copyright.trim(),
          license: license.trim(),
        },
      },
    };
    try {
      await api.saveProject(project.path, updated.project);
      onProject(updated);
      onNotice("تم حفظ بيانات التصدير", "ok");
    } catch (error) {
      onNotice(String(error), "error");
    }
  }

  return (
    <section className="panel project-panel">
      <PanelHeader
        icon="folderOpen"
        title="المشروع"
        subtitle="مجلد قابل للنقل بصيغة .afsp"
        actions={<span className="panel-index">01</span>}
      />

      <div className="panel-body">
        <SectionLabel icon="sparkle">إنشاء مشروع</SectionLabel>
        <div className="form-stack">
          <label htmlFor="pp-name">اسم المشروع</label>
          <input id="pp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: خط الربيع" />

          <label htmlFor="pp-family">اسم العائلة</label>
          <input id="pp-family" value={family} onChange={(e) => setFamily(e.target.value)} placeholder="Arabic Spring" />

          <div className="form-row">
            <div>
              <label htmlFor="pp-style">النمط</label>
              <input id="pp-style" value={style} onChange={(e) => setStyle(e.target.value)} />
            </div>
            <div>
              <label htmlFor="pp-upm">UPM</label>
              <select id="pp-upm" value={upm} onChange={(e) => setUpm(Number(e.target.value))}>
                <option value={1000}>1000</option>
                <option value={2048}>2048</option>
              </select>
            </div>
          </div>
        </div>

        <div className="button-row">
          <button className="primary" onClick={() => void createProject()} disabled={!name.trim()}>
            إنشاء مشروع
          </button>
          <button onClick={() => void openProject()}>فتح</button>
          <button onClick={() => void saveProject()} disabled={!project}>حفظ</button>
        </div>

        {project ? (
          <div className="project-card">
            <div className="project-card-title">
              <span className="project-avatar">{project.project.font.familyName.slice(0, 1)}</span>
              <span>
                <strong>{project.project.font.familyName}</strong>
                <small>{project.project.font.styleName} · {project.project.font.unitsPerEm} UPM</small>
              </span>
            </div>
            <div className="data-list">
              <div><span>المسار</span><code className="path">{project.path}</code></div>
              <div><span>المخطط</span><code>{project.project.schemaVersion}</code></div>
              <div><span>الخانات</span><code>{project.project.glyphSlots.length}</code></div>
            </div>

            <SectionLabel icon="fileText">بيانات التصدير</SectionLabel>
            <div className="form-stack">
              <label htmlFor="pp-version">الإصدار</label>
              <input id="pp-version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.000" dir="ltr" />
              <label htmlFor="pp-designer">المصمم</label>
              <input id="pp-designer" value={designer} onChange={(e) => setDesigner(e.target.value)} placeholder="اسم المصمم" />
              <label htmlFor="pp-copyright">حقوق النشر</label>
              <input id="pp-copyright" value={copyright} onChange={(e) => setCopyright(e.target.value)} placeholder="Copyright …" dir="ltr" />
              <label htmlFor="pp-license">الترخيص</label>
              <input id="pp-license" value={license} onChange={(e) => setLicense(e.target.value)} placeholder="OFL-1.1" dir="ltr" />
            </div>
            <div className="button-row">
              <button onClick={() => void saveExportMetadata()}>حفظ بيانات التصدير</button>
            </div>
          </div>
        ) : (
          <div className="empty-card"><Icon name="info" size={14} /> لا يوجد مشروع مفتوح حالياً.</div>
        )}
      </div>
    </section>
  );
}
