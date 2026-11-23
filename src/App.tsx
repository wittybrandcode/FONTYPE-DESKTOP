import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import BuildPanel from "./components/BuildPanel";
import EnginePanel from "./components/EnginePanel";
import GlyphWorkspace from "./components/GlyphWorkspace";
import InventoryPanel from "./components/InventoryPanel";
import ProjectPanel from "./components/ProjectPanel";
import SpikePanel from "./components/SpikePanel";
import { api, runEngineJob } from "./core/api";
import type { ProjectHandle } from "./core/types";
import { Icon, type IconName } from "./ui/icons";
import { IconButton, StatusChip, ToolbarDivider } from "./ui/components";
import ShortcutsDialog from "./ui/ShortcutsDialog";

type Tab = "workspace" | "inventory" | "build" | "engine";
type NoticeKind = "ok" | "error";

interface Toast {
  id: number;
  text: string;
  kind: NoticeKind;
}

const TABS: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: "workspace", label: "مساحة العمل", icon: "cursor" },
  { id: "inventory", label: "مخزون الخانات", icon: "grid" },
  { id: "build", label: "البناء والمعاينة", icon: "pulse" },
  { id: "engine", label: "المحرك والاختبار الرأسي", icon: "cube" },
];

export default function App() {
  const [project, setProject] = useState<ProjectHandle | null>(null);
  const [engineInfo, setEngineInfo] = useState<Record<string, unknown> | null>(null);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [healthStatus, setHealthStatus] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [tab, setTab] = useState<Tab>("workspace");
  const [focusSlotId, setFocusSlotId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const toastId = useRef(0);

  useEffect(() => {
    api
      .engineInfo()
      .then(setEngineInfo)
      .catch((error) => showNotice(String(error), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;
      if (typing) return;
      if (event.key === "?") setShortcutsOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function showNotice(text: string, kind: NoticeKind = "ok") {
    const id = ++toastId.current;
    setToasts((current) => [...current, { id, text, kind }].slice(-4));
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 5200);
  }

  async function checkEngine() {
    setHealthStatus("checking");
    try {
      const data = await runEngineJob("health", {});
      setHealth(data);
      const ok = data.ok === true;
      setHealthStatus(ok ? "ok" : "error");
      showNotice(String(data.message ?? ""), ok ? "ok" : "error");
    } catch (error) {
      setHealthStatus("error");
      showNotice(`فحص المحرك فشل: ${String(error)}`, "error");
    }
  }

  async function openProject() {
    try {
      const path = await open({ directory: true, multiple: false, title: "اختر مجلد المشروع (.afsp)" });
      if (typeof path !== "string") return;
      const handle = await api.openProject(path);
      setProject(handle);
      showNotice("تم فتح المشروع", "ok");
      if (handle.migrationNotes.length > 0) showNotice(handle.migrationNotes.join(" · "), "ok");
    } catch (error) {
      showNotice(String(error), "error");
    }
  }

  async function saveProject() {
    if (!project) return;
    try {
      await api.saveProject(project.path, project.project);
      showNotice("تم حفظ المشروع", "ok");
    } catch (error) {
      showNotice(String(error), "error");
    }
  }

  const slots = project?.project.glyphSlots ?? [];
  const ready = slots.filter((slot) => slot.status === "ready").length;
  const review = slots.filter((slot) => slot.status === "needs-review").length;
  const healthTone =
    healthStatus === "ok" ? "accent" : healthStatus === "error" ? "danger" : healthStatus === "checking" ? "warning" : "neutral";

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="brand">
          <span className="brand-mark">ف</span>
          <div>
            <h1>FONTYPE</h1>
            <p>استوديو الخطوط العربية</p>
          </div>
        </div>

        <div className="topbar-context">
          <span>المشروع الحالي</span>
          <strong>{project ? project.project.font.familyName : "لا يوجد مشروع مفتوح"}</strong>
        </div>

        <div className="topbar-meta">
          <span className="phase-chip">المرحلة 6 — التثبيت والإصدار</span>
          <span className="version-chip">v0.6.0</span>
        </div>

        <div className="topbar-actions">
          <IconButton icon="sidebar" label={sidebarOpen ? "إخفاء لوحة المشروع" : "إظهار لوحة المشروع"} active={sidebarOpen} onClick={() => setSidebarOpen((value) => !value)} />
          <ToolbarDivider />
          <IconButton icon="folderOpen" label="فتح مشروع" onClick={() => void openProject()} />
          <IconButton icon="save" label="حفظ المشروع" disabled={!project} onClick={() => void saveProject()} />
          <IconButton icon="pulse" label="البناء والمعاينة" onClick={() => setTab("build")} />
          <ToolbarDivider />
          <IconButton icon="keyboard" label="اختصارات لوحة المفاتيح" shortcut="?" onClick={() => setShortcutsOpen(true)} />
        </div>
      </header>

      <main className={`workspace-shell ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
        <aside className="column sidebar">
          <ProjectPanel project={project} onProject={setProject} onNotice={showNotice} />
          <EnginePanel info={engineInfo} health={health} status={healthStatus} onCheck={checkEngine} />
        </aside>

        <section className="column main-column">
          <div className="tabs" role="tablist" aria-label="أقسام العمل">
            {TABS.map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={tab === item.id}
                className={tab === item.id ? "active" : ""}
                onClick={() => setTab(item.id)}
              >
                <Icon name={item.icon} size={17} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>

          {tab === "workspace" ? (
            project ? (
              <GlyphWorkspace
                project={project}
                onProject={setProject}
                onNotice={showNotice}
                initialSlotId={focusSlotId}
              />
            ) : (
              <div className="panel empty-workspace">
                <div className="empty-state">
                  <span className="empty-state-icon"><Icon name="cursor" size={26} /></span>
                  <h2>مساحة عمل الخط</h2>
                  <p className="hint">
                    افتح مشروعاً واستورد رسماً لحرف ما ليظهر هنا مع المساطر وخطوط القياس
                    والأدلة والشبكة والالتقاط الذكي.
                  </p>
                </div>
              </div>
            )
          ) : tab === "inventory" ? (
            project ? (
              <InventoryPanel project={project} onProject={setProject} onNotice={showNotice} />
            ) : (
              <div className="panel empty-workspace">
                <div className="empty-state">
                  <span className="empty-state-icon"><Icon name="grid" size={26} /></span>
                  <h2>ابدأ بإنشاء مشروع</h2>
                  <p className="hint">
                    أنشئ مشروعاً جديداً أو افتح مشروعاً موجوداً بصيغة <code>.afsp</code> لتوليد
                    مخزون الخانات واستيراد رسومات SVG لكل خانة على حدة.
                  </p>
                </div>
              </div>
            )
          ) : tab === "build" ? (
            <BuildPanel
              project={project}
              onProject={setProject}
              onNotice={showNotice}
              onOpenSlot={(slotId) => {
                setFocusSlotId(slotId);
                setTab("workspace");
              }}
            />
          ) : (
            <SpikePanel project={project} onNotice={showNotice} />
          )}
        </section>
      </main>

      <div className="toast-stack" role="region" aria-label="الإشعارات">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}`} role="status">
            <Icon name={toast.kind === "ok" ? "checkCircle" : "warning"} size={17} />
            <span>{toast.text}</span>
          </div>
        ))}
      </div>

      <footer className="app-statusbar">
        <span className="status-item">
          <Icon name="cube" size={13} />
          {project ? <strong>{project.project.font.familyName}</strong> : <span>لا يوجد مشروع</span>}
        </span>
        <span className="status-sep" />
        <span className="status-item status-optional">الخانات: <strong>{slots.length}</strong></span>
        <span className="status-item status-optional">معتمدة: <strong>{ready}</strong></span>
        <span className="status-item status-optional">تحت المراجعة: <strong>{review}</strong></span>
        <span className="status-grow" />
        <StatusChip tone={healthTone} icon={healthStatus === "ok" ? "check" : healthStatus === "error" ? "warning" : "pulse"}>
          {healthStatus === "ok" ? "المحرك جاهز" : healthStatus === "error" ? "المحرك غير جاهز" : healthStatus === "checking" ? "جارٍ الفحص" : "المحرك لم يُفحص"}
        </StatusChip>
        <span className="status-item" dir="ltr">v0.6.0</span>
      </footer>

      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
