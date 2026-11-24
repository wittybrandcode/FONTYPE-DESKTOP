import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import ActivityRail from "./ui/ActivityRail";
import BuildPanel from "./components/BuildPanel";
import CommandPalette, { type CommandAction } from "./ui/CommandPalette";
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

const TABS: Array<{ id: Tab; label: string; description: string; icon: IconName }> = [
  { id: "workspace", label: "مساحة العمل", description: "تحرير الرسوم والمساطر والمراسي", icon: "cursor" },
  { id: "inventory", label: "مخزون الخانات", description: "استيراد الخانات وإدارة حالتها", icon: "grid" },
  { id: "build", label: "البناء والمعاينة", description: "توليد الخط واختبار التشكيل", icon: "pulse" },
  { id: "engine", label: "المحرك", description: "فحص الأدوات والتشخيص", icon: "cube" },
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
  const [commandOpen, setCommandOpen] = useState(false);
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }
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
  const imported = slots.filter((slot) => slot.import !== null).length;
  const healthTone =
    healthStatus === "ok" ? "accent" : healthStatus === "error" ? "danger" : healthStatus === "checking" ? "warning" : "neutral";
  const railTone =
    healthStatus === "ok" ? "ok" : healthStatus === "error" ? "error" : healthStatus === "checking" ? "warn" : "idle";
  const healthLabel =
    healthStatus === "ok" ? "المحرك جاهز" : healthStatus === "error" ? "المحرك غير جاهز" : healthStatus === "checking" ? "جارٍ فحص المحرك" : "المحرك لم يُفحص";
  const activeTab = TABS.find((item) => item.id === tab) ?? TABS[0];

  const commands: CommandAction[] = [
    ...TABS.map((item) => ({
      id: `tab-${item.id}`,
      label: item.label,
      description: item.description,
      group: "التنقل",
      icon: item.icon,
      run: () => setTab(item.id),
    })),
    {
      id: "open-project",
      label: "فتح مشروع",
      description: "فتح مجلد مشروع .afsp من القرص المحلي",
      group: "المشروع",
      icon: "folderOpen",
      shortcut: "Ctrl+O",
      run: () => void openProject(),
    },
    {
      id: "save-project",
      label: "حفظ المشروع",
      description: "كتابة التغييرات إلى ملف المشروع",
      group: "المشروع",
      icon: "save",
      shortcut: "Ctrl+S",
      run: () => void saveProject(),
    },
    {
      id: "build",
      label: "بناء الخط",
      description: "الانتقال إلى لوحة البناء والمعاينة",
      group: "المشروع",
      icon: "pulse",
      run: () => setTab("build"),
    },
    {
      id: "check-engine",
      label: "فحص صحة المحرك",
      description: "التحقق من Python والأدوات المحلية",
      group: "النظام",
      icon: "shield",
      run: () => {
        setTab("engine");
        void checkEngine();
      },
    },
    {
      id: "toggle-sidebar",
      label: sidebarOpen ? "إخفاء لوحة المشروع" : "إظهار لوحة المشروع",
      group: "العرض",
      icon: "sidebar",
      run: () => setSidebarOpen((value) => !value),
    },
    {
      id: "shortcuts",
      label: "اختصارات لوحة المفاتيح",
      group: "العرض",
      icon: "keyboard",
      shortcut: "?",
      run: () => setShortcutsOpen(true),
    },
  ];

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="topbar-brand">
          <span className="brand-mark">ف</span>
          <div className="brand-copy">
            <strong>FONTYPE</strong>
            <span>استوديو الخطوط العربية</span>
          </div>
        </div>

        <div className="topbar-breadcrumb" aria-label="مسار المشروع">
          <span>المشاريع</span>
          <Icon name="chevronLeft" size={12} />
          <strong>{project ? project.project.font.familyName : "لا يوجد مشروع مفتوح"}</strong>
          <Icon name="chevronLeft" size={12} />
          <span className="breadcrumb-current">{activeTab.label}</span>
        </div>

        <button type="button" className="command-trigger" onClick={() => setCommandOpen(true)}>
          <Icon name="search" size={15} />
          <span>بحث سريع أو أمر…</span>
          <kbd>Ctrl K</kbd>
        </button>

        <div className="topbar-meta">
          <span className="local-chip"><Icon name="shield" size={12} /> محلي بالكامل</span>
          <span className="phase-chip">المرحلة 6 — التثبيت والإصدار</span>
          <span className="version-chip">v0.6.0</span>
        </div>

        <div className="topbar-actions">
          <IconButton icon="folderOpen" label="فتح مشروع" onClick={() => void openProject()} />
          <IconButton icon="save" label="حفظ المشروع" disabled={!project} onClick={() => void saveProject()} />
          <ToolbarDivider />
          <IconButton icon="pulse" label="البناء والمعاينة" onClick={() => setTab("build")} />
        </div>
      </header>

      <main className={`workspace-shell ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
        <ActivityRail
          items={TABS.map((item) => ({
            id: item.id,
            label: item.label,
            icon: item.icon,
            badge: item.id === "inventory" && review > 0 ? review : undefined,
          }))}
          activeId={tab}
          onSelect={(id) => setTab(id as Tab)}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((value) => !value)}
          onCommand={() => setCommandOpen(true)}
          onShortcuts={() => setShortcutsOpen(true)}
          healthLabel={healthLabel}
          healthTone={railTone}
        />

        <aside className="column sidebar" aria-label="لوحات المشروع">
          <div className="sidebar-titlebar">
            <span>المشروع</span>
            <IconButton
              icon="sidebar"
              label={sidebarOpen ? "طي اللوحة" : "فرد اللوحة"}
              size={15}
              onClick={() => setSidebarOpen((value) => !value)}
            />
          </div>
          <ProjectPanel project={project} onProject={setProject} onNotice={showNotice} />
          <EnginePanel info={engineInfo} health={health} status={healthStatus} onCheck={checkEngine} />
        </aside>

        <section className="column main-column">
          <div className="document-bar">
            <div className="document-identity">
              <span className="document-icon"><Icon name={activeTab.icon} size={18} /></span>
              <div>
                <h1>{activeTab.label}</h1>
                <p>{activeTab.description}</p>
              </div>
            </div>
            <div className="document-stats">
              <span className="doc-stat"><i /> {slots.length} خانة</span>
              <span className="doc-stat doc-stat--accent"><i /> {ready} معتمدة</span>
              <span className="doc-stat doc-stat--warning"><i /> {review} للمراجعة</span>
              <span className="doc-stat doc-stat--info"><i /> {imported} مستوردة</span>
            </div>
          </div>

          <div className="tabs" role="tablist" aria-label="أقسام العمل">
            {TABS.map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={tab === item.id}
                className={tab === item.id ? "active" : ""}
                onClick={() => setTab(item.id)}
              >
                <Icon name={item.icon} size={15} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>

          <div className="view-surface">
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
                    <div className="button-row">
                      <button className="primary" onClick={() => void openProject()}>فتح مشروع</button>
                    </div>
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
          </div>
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
        <span className="status-item status-project">
          <Icon name="cube" size={13} />
          {project ? <strong>{project.project.font.familyName}</strong> : <span>لا يوجد مشروع</span>}
        </span>
        <span className="status-sep" />
        <span className="status-item status-optional">الخانات: <strong>{slots.length}</strong></span>
        <span className="status-item status-optional">معتمدة: <strong>{ready}</strong></span>
        <span className="status-item status-optional">تحت المراجعة: <strong>{review}</strong></span>
        <span className="status-grow" />
        <button type="button" className="status-command" onClick={() => setCommandOpen(true)}>
          <Icon name="command" size={12} /> الأوامر <kbd>Ctrl K</kbd>
        </button>
        <StatusChip tone={healthTone} icon={healthStatus === "ok" ? "check" : healthStatus === "error" ? "warning" : "pulse"}>
          {healthLabel}
        </StatusChip>
        <span className="status-item" dir="ltr">v0.6.0</span>
      </footer>

      <CommandPalette open={commandOpen} actions={commands} onClose={() => setCommandOpen(false)} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
