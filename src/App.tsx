import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, buildFontSource, runEngineJob } from "./core/api";
import { buildReadiness } from "./core/readiness";
import type { ProjectHandle } from "./core/types";
import BuildPanel from "./components/BuildPanel";
import EnginePanel from "./components/EnginePanel";
import GlyphWorkspace, { type EditorActions } from "./components/GlyphWorkspace";
import InventoryPanel from "./components/InventoryPanel";
import ProjectPanel from "./components/ProjectPanel";
import SpikePanel from "./components/SpikePanel";
import CommandPalette, { type CommandAction } from "./ui/CommandPalette";
import GlyphDock from "./ui/GlyphDock";
import MenuBar, { type MenuGroup } from "./ui/MenuBar";
import ProjectDialog from "./ui/ProjectDialog";
import ShortcutsDialog from "./ui/ShortcutsDialog";
import { Icon, type IconName } from "./ui/icons";
import { DockResizer, EmptyState, IconButton, SegmentedControl, StatusChip, ToolbarDivider } from "./ui/components";

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

const VERSION = "v0.6.0";

export default function App() {
  const [project, setProject] = useState<ProjectHandle | null>(null);
  const [engineInfo, setEngineInfo] = useState<Record<string, unknown> | null>(null);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [healthStatus, setHealthStatus] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [tab, setTab] = useState<Tab>("workspace");
  const [dockView, setDockView] = useState<"glyphs" | "project" | "engine">("glyphs");
  const [focusSlotId, setFocusSlotId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(272);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [editor, setEditor] = useState<EditorActions | null>(null);
  const toastId = useRef(0);
  const registerEditor = useCallback((actions: EditorActions | null) => setEditor(actions), []);
  const readiness = useMemo(() => buildReadiness(project), [project]);

  useEffect(() => {
    api
      .engineInfo()
      .then(setEngineInfo)
      .catch((error) => showNotice(String(error), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && key === "k") {
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
      if (modifier && key === "o") {
        event.preventDefault();
        void openProject();
      } else if (modifier && key === "s") {
        event.preventDefault();
        void saveProject();
      } else if (modifier && key === "b") {
        event.preventDefault();
        setTab("build");
      } else if (modifier && key === "n") {
        event.preventDefault();
        setNewProjectOpen(true);
      } else if (event.key === "?" && !modifier) {
        setShortcutsOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  function showNotice(text: string, kind: NoticeKind = "ok") {
    const id = ++toastId.current;
    setToasts((current) => [...current, { id, text, kind }].slice(-4));
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4600);
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

  async function backupProject() {
    if (!project) return;
    try {
      const path = await api.backupProject(project.path);
      showNotice(`تم إنشاء نسخة احتياطية: ${path}`, "ok");
    } catch (error) {
      showNotice(String(error), "error");
    }
  }

  async function generateSource() {
    if (!project) return;
    try {
      const result = await buildFontSource(project);
      showNotice(
        `أُنشئ مصدر UFO: ${result.glyphCount ?? 0} حرف · ${result.anchorCount ?? 0} مرساة`,
        "ok",
      );
    } catch (error) {
      showNotice(`فشل إنشاء مصدر UFO: ${String(error)}`, "error");
    }
  }

  const slots = project?.project.glyphSlots ?? [];
  const ready = slots.filter((slot) => slot.status === "ready").length;
  const review = slots.filter((slot) => slot.status === "needs-review").length;
  const imported = slots.filter((slot) => slot.import !== null).length;
  const healthTone =
    healthStatus === "error" ? "danger" : healthStatus === "checking" ? "warning" : healthStatus === "ok" ? "accent" : "neutral";
  const healthLabel =
    healthStatus === "ok" ? "المحرك جاهز" : healthStatus === "error" ? "المحرك غير جاهز" : healthStatus === "checking" ? "جارٍ فحص المحرك" : "المحرك لم يُفحص";
  const familyName = project?.project.font.familyName ?? "لا يوجد مشروع مفتوح";

  const commands: CommandAction[] = [
    ...TABS.map((item) => ({
      id: `tab-${item.id}`,
      label: item.label,
      description: item.description,
      group: "التنقل",
      icon: item.icon,
      run: () => setTab(item.id),
    })),
    { id: "new-project", label: "مشروع جديد", description: "إنشاء مشروع .afsp محلي", group: "المشروع", icon: "plus", shortcut: "Ctrl+N", run: () => setNewProjectOpen(true) },
    { id: "open-project", label: "فتح مشروع", description: "فتح مجلد مشروع .afsp من القرص المحلي", group: "المشروع", icon: "folderOpen", shortcut: "Ctrl+O", run: () => void openProject() },
    { id: "save-project", label: "حفظ المشروع", description: "كتابة التغييرات إلى ملف المشروع", group: "المشروع", icon: "save", shortcut: "Ctrl+S", run: () => void saveProject() },
    { id: "backup-project", label: "نسخة احتياطية", description: "إنشاء نسخة احتياطية من المشروع الحالي", group: "المشروع", icon: "archive", run: () => void backupProject() },
    { id: "build", label: "بناء الخط", description: "الانتقال إلى لوحة البناء والمعاينة", group: "المشروع", icon: "pulse", shortcut: "Ctrl+B", run: () => setTab("build") },
    { id: "source", label: "توليد مصدر UFO", description: "كتابة UFO كامل من الخانات الحالية", group: "المشروع", icon: "ufo", run: () => void generateSource() },
    { id: "check-engine", label: "فحص صحة المحرك", description: "التحقق من Python والأدوات المحلية", group: "النظام", icon: "shield", run: () => { setTab("engine"); void checkEngine(); } },
    { id: "toggle-sidebar", label: sidebarOpen ? "إخفاء لوحة المشروع" : "إظهار لوحة المشروع", group: "العرض", icon: "sidebar", run: () => setSidebarOpen((value) => !value) },
    { id: "shortcuts", label: "اختصارات لوحة المفاتيح", group: "العرض", icon: "keyboard", shortcut: "?", run: () => setShortcutsOpen(true) },
    ...(editor?.commands ?? []).map((command) => ({
      ...command,
      icon: command.icon as IconName,
    })),
  ];

  const menuGroups: MenuGroup[] = [
    {
      id: "file",
      label: "ملف",
      items: [
        { id: "new", label: "مشروع جديد…", shortcut: "Ctrl+N", icon: "plus", run: () => setNewProjectOpen(true) },
        { id: "open", label: "فتح مشروع…", shortcut: "Ctrl+O", icon: "folderOpen", run: () => void openProject() },
        { id: "save", label: "حفظ المشروع", shortcut: "Ctrl+S", icon: "save", disabled: !project, run: () => void saveProject() },
        { id: "backup", label: "نسخة احتياطية", icon: "archive", disabled: !project, separatorBefore: true, run: () => void backupProject() },
        { id: "restore", label: "استعادة نسخة احتياطية…", icon: "history", disabled: !project, run: () => { setTab("build"); showNotice("استخدم قسم النسخ الاحتياطي في لوحة البناء", "ok"); } },
        { id: "quit", label: "خروج", icon: "close", separatorBefore: true, run: () => {
          void getCurrentWindow()
            .close()
            .catch(() => showNotice("إغلاق النافذة غير متاح في المعاينة", "error"));
        } },
      ],
    },
    {
      id: "edit",
      label: "تحرير",
      items: [
        { id: "undo", label: "تراجع", shortcut: "Ctrl+Z", icon: "undo", disabled: !editor?.canUndo, run: () => editor?.undo() },
        { id: "redo", label: "إعادة", shortcut: "Ctrl+Shift+Z", icon: "redo", disabled: !editor?.canRedo, run: () => editor?.redo() },
        { id: "palette", label: "لوحة الأوامر…", shortcut: "Ctrl+K", icon: "command", separatorBefore: true, run: () => setCommandOpen(true) },
        { id: "shortcuts", label: "اختصارات لوحة المفاتيح", shortcut: "?", icon: "keyboard", run: () => setShortcutsOpen(true) },
      ],
    },
    {
      id: "view",
      label: "عرض",
      items: [
        { id: "sidebar", label: sidebarOpen ? "إخفاء لوحة المشروع" : "إظهار لوحة المشروع", icon: "sidebar", run: () => setSidebarOpen((value) => !value) },
        ...TABS.map((item) => ({ id: `view-${item.id}`, label: item.label, icon: item.icon, separatorBefore: item.id === "workspace", run: () => setTab(item.id) })),
      ],
    },
    {
      id: "project",
      label: "مشروع",
      items: [
        { id: "source", label: "توليد مصدر UFO", icon: "ufo", disabled: !project, run: () => void generateSource() },
        { id: "build", label: "بناء الخط", shortcut: "Ctrl+B", icon: "pulse", run: () => setTab("build") },
        { id: "engine", label: "فحص المحرك", icon: "shield", separatorBefore: true, run: () => { setTab("engine"); void checkEngine(); } },
      ],
    },
    {
      id: "help",
      label: "مساعدة",
      items: [
        { id: "shortcuts", label: "اختصارات لوحة المفاتيح", icon: "keyboard", run: () => setShortcutsOpen(true) },
        { id: "about", label: "حول FONTYPE", icon: "info", separatorBefore: true, run: () => showNotice(`FONTYPE ${VERSION} — استوديو خطوط عربي محلي بالكامل`, "ok") },
      ],
    },
  ];

  const activeTab = TABS.find((item) => item.id === tab) ?? TABS[0];
  const readinessTip = readiness.checks.filter((item) => !item.ok)
    .map((item) => `${item.label}: ${item.detail}`).join("\n") || readiness.summary;

  return (
    <div className="app-shell">
      <MenuBar
        groups={menuGroups}
        version={VERSION}
        onCommand={() => setCommandOpen(true)}
        onShortcuts={() => setShortcutsOpen(true)}
      />

      <div className="chrome-region" role="region" aria-label="شريط الأدوات">
      <div className="tool-bar" role="toolbar" aria-label="أدوات التطبيق">
        <IconButton icon="plus" label="مشروع جديد" shortcut="Ctrl+N" onClick={() => setNewProjectOpen(true)} />
        <IconButton icon="folderOpen" label="فتح مشروع" shortcut="Ctrl+O" onClick={() => void openProject()} />
        <IconButton icon="save" label="حفظ المشروع" shortcut="Ctrl+S" disabled={!project} onClick={() => void saveProject()} />
        <ToolbarDivider />
        <IconButton icon="undo" label="تراجع" shortcut="Ctrl+Z" disabled={!editor?.canUndo} onClick={() => editor?.undo()} />
        <IconButton icon="redo" label="إعادة" shortcut="Ctrl+Shift+Z" disabled={!editor?.canRedo} onClick={() => editor?.redo()} />
        <ToolbarDivider />
        <IconButton
          icon="sidebar"
          label={sidebarOpen ? "إخفاء لوحة المشروع" : "إظهار لوحة المشروع"}
          active={sidebarOpen}
          onClick={() => setSidebarOpen((value) => !value)}
        />
        <IconButton icon="shield" label="فحص المحرك" onClick={() => { setTab("engine"); void checkEngine(); }} />
        <button
          type="button"
          className={`readiness-chip readiness-chip--${readiness.level} has-tip`}
          data-tip={readinessTip}
          aria-describedby="readiness-tip"
          onClick={() => setTab("build")}
        >
          <Icon name={readiness.level === "ready" ? "checkCircle" : readiness.level === "blocked" ? "warning" : "info"} size={13} />
          <span>{readiness.summary}</span>
          <span id="readiness-tip" className="sr-only">{readinessTip}</span>
        </button>
        <ToolbarDivider />

        <button type="button" className="tool-bar-command" onClick={() => setCommandOpen(true)}>
          <Icon name="search" size={13} />
          <span>بحث سريع أو أمر…</span>
          <span className="kbd">Ctrl K</span>
        </button>

        <div className="tool-bar-spacer" />
        <div className="tool-bar-actions">
          <button type="button" className="ui-button" onClick={() => setTab("build")}>
            <Icon name="eye" size={14} /> معاينة
          </button>
          <button type="button" className="ui-button ui-button--primary" onClick={() => setTab("build")}>
            <Icon name="pulse" size={14} /> بناء الخط
          </button>
        </div>
      </div>
      </div>

      <div className="chrome-region" role="region" aria-label="تبويبات المستندات">
      <div className="document-tabs" role="tablist" aria-label="مساحات العمل">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className="document-tab"
            onClick={() => setTab(item.id)}
          >
            <Icon name={item.icon} size={14} />
            <span>{item.label}</span>
            {item.id === "inventory" && review > 0 ? <span className="tab-badge">{review}</span> : null}
          </button>
        ))}
        <div className="document-tabs-meta">
          <strong>{familyName}</strong>
          <code dir="ltr">{project?.project.font.unitsPerEm ?? 1000} UPM</code>
          <span>محلي</span>
        </div>
      </div>
      </div>

      <main
        className={`workspace-shell ${sidebarOpen ? "" : "sidebar-collapsed"}`}
        style={{ "--sidebar-w": `${sidebarWidth}px` } as CSSProperties}
      >
        <aside className="dock dock--left" aria-label="لوحة المستند">
          <div className="dock-titlebar">
            <span>دوكس المستند</span>
            <IconButton
              icon="sidebar"
              label={sidebarOpen ? "طي اللوحة" : "فرد اللوحة"}
              size={14}
              onClick={() => setSidebarOpen((value) => !value)}
            />
          </div>
          <div className="dock-view-tabs">
            <SegmentedControl
              label="عرض لوحة المستند"
              value={dockView}
              options={[
                { value: "glyphs", label: "الحروف", icon: "grid" },
                { value: "project", label: "المشروع", icon: "fileText" },
                { value: "engine", label: "المحرك", icon: "shield" },
              ]}
              onChange={setDockView}
            />
          </div>
          <div className="dock-body">
            {dockView === "glyphs" ? (
              project ? (
                <GlyphDock
                  slots={slots}
                  selectedId={focusSlotId}
                  onSelect={(slotId) => { setFocusSlotId(slotId); setTab("workspace"); }}
                />
              ) : (
                <div className="glyph-dock-empty">
                  <Icon name="grid" size={18} />
                  <p>افتح مشروعاً لعرض الخانات.</p>
                </div>
              )
            ) : dockView === "project" ? (
              <ProjectPanel project={project} onProject={setProject} onNotice={showNotice} />
            ) : (
              <EnginePanel info={engineInfo} health={health} status={healthStatus} onCheck={checkEngine} />
            )}
          </div>
        </aside>
        <DockResizer
          label="تغيير عرض لوحة المستند"
          value={sidebarWidth}
          min={220}
          max={420}
          onChange={setSidebarWidth}
          reverse
        />

        <section className="view-surface" aria-label={activeTab.label}>
          {tab === "workspace" ? (
            project ? (
              <GlyphWorkspace
                project={project}
                onProject={setProject}
                onNotice={showNotice}
                initialSlotId={focusSlotId}
                registerEditor={registerEditor}
                onOpenInventory={() => setTab("inventory")}
              />
            ) : (
              <div className="panel empty-workspace">
                <EmptyState
                  icon="cursor"
                  title="لا يوجد مستند مفتوح"
                  description="ثلاث خطوات تفصلك عن أول خط عربي قابل للبناء."
                  steps={[
                    "أنشئ مشروعاً محلياً بصيغة .afsp أو افتح مشروعاً موجوداً.",
                    "استورد SVG لكل شكل من أشكال الحرف في خانته المخصصة.",
                    "اضبط المساطر والمراسي، ثم راجع التحقق قبل بناء الخط.",
                  ]}
                  note={<><Icon name="shield" size={13} /><span>لا تُرسل الرسومات أو بيانات المشروع إلى أي خدمة شبكية.</span></>}
                  action={
                    <>
                      <button type="button" className="primary" onClick={() => setNewProjectOpen(true)}>مشروع جديد</button>
                      <button type="button" onClick={() => void openProject()}>فتح مشروع</button>
                    </>
                  }
                />
              </div>
            )
          ) : tab === "inventory" ? (
            project ? (
              <InventoryPanel project={project} onProject={setProject} onNotice={showNotice} />
            ) : (
              <div className="panel empty-workspace">
                <EmptyState
                  icon="grid"
                  title="لا توجد خانات"
                  description="مخزون الخانات يُنشأ مع المشروع، وتبقى هوية كل خانة مرتبطة بالمشروع لا باسم ملف SVG."
                  steps={[
                    "أنشئ مشروعاً جديداً أو افتح مشروعاً بصيغة .afsp.",
                    "راجع قائمة الأشكال المطلوبة لكل حرف.",
                  ]}
                  action={<button type="button" className="primary" onClick={() => setNewProjectOpen(true)}>مشروع جديد</button>}
                />
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
          <div key={toast.id} className={`toast ${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}>
            <Icon name={toast.kind === "ok" ? "checkCircle" : "warning"} size={15} />
            <span>{toast.text}</span>
          </div>
        ))}
      </div>

      <footer className="app-statusbar">
        <span className="status-item status-project">
          <Icon name="cube" size={12} />
          <strong>{familyName}</strong>
        </span>
        <span className="status-sep" />
        <span className="status-item status-optional">الخانات: <strong>{slots.length}</strong></span>
        <span className="status-item status-optional">معتمدة: <strong>{ready}</strong></span>
        <span className="status-item status-optional">للمراجعة: <strong>{review}</strong></span>
        <span className="status-item status-optional">مستوردة: <strong>{imported}</strong></span>
        <span className="status-item status-progress" aria-label={`الخانات المعتمدة ${ready} من ${slots.length}`}>
          <span>جاهزية</span>
          <span className="status-progress-track" aria-hidden="true">
            <span className="status-progress-fill" style={{ width: `${slots.length ? (ready / slots.length) * 100 : 0}%` }} />
          </span>
          <strong>{ready}/{slots.length}</strong>
        </span>
        <span className="status-grow" />
        <span className="status-item">{activeTab.label}</span>
        <button type="button" className="status-command" onClick={() => setCommandOpen(true)}>
          <Icon name="command" size={11} /> الأوامر <span className="kbd">Ctrl K</span>
        </button>
        <StatusChip tone={healthTone} icon={healthStatus === "ok" ? "check" : healthStatus === "error" ? "warning" : "pulse"}>
          {healthLabel}
        </StatusChip>
        <span className="status-item" dir="ltr">{VERSION}</span>
      </footer>

      <CommandPalette open={commandOpen} actions={commands} onClose={() => setCommandOpen(false)} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <ProjectDialog
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreated={(handle) => { setProject(handle); setTab("workspace"); }}
        onNotice={showNotice}
      />
    </div>
  );
}
