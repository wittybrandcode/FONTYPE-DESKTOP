import { useEffect, useState } from "react";
import BuildPanel from "./components/BuildPanel";
import EnginePanel from "./components/EnginePanel";
import GlyphWorkspace from "./components/GlyphWorkspace";
import InventoryPanel from "./components/InventoryPanel";
import ProjectPanel from "./components/ProjectPanel";
import SpikePanel from "./components/SpikePanel";
import { api, runEngineJob } from "./core/api";
import type { ProjectHandle } from "./core/types";

interface Notice {
  text: string;
  kind: "ok" | "error";
}

type Tab = "workspace" | "inventory" | "build" | "engine";

export default function App() {
  const [project, setProject] = useState<ProjectHandle | null>(null);
  const [engineInfo, setEngineInfo] = useState<Record<string, unknown> | null>(null);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [healthStatus, setHealthStatus] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [tab, setTab] = useState<Tab>("workspace");
  const [focusSlotId, setFocusSlotId] = useState<string | null>(null);

  useEffect(() => {
    api
      .engineInfo()
      .then(setEngineInfo)
      .catch((error) => showNotice(String(error), "error"));
  }, []);

  function showNotice(text: string, kind: "ok" | "error" = "ok") {
    setNotice({ text, kind });
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">ف</span>
          <div>
            <h1>FONTYPE</h1>
            <p>استوديو الخطوط العربية</p>
          </div>
        </div>
        <div className="topbar-meta">
          <span className="phase-chip">المرحلة 6 — التثبيت والإصدار</span>
          <span className="version-chip">v0.6.0</span>
        </div>
      </header>

      {notice ? (
        <div className={`notice ${notice.kind}`} role="status">
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="إخفاء">✕</button>
        </div>
      ) : null}

      <main className="workspace phase-one">
        <aside className="column sidebar">
          <ProjectPanel project={project} onProject={setProject} onNotice={showNotice} />
          <EnginePanel
            info={engineInfo}
            health={health}
            status={healthStatus}
            onCheck={checkEngine}
          />
        </aside>

        <section className="column main-column">
          <div className="tabs" role="tablist" aria-label="أقسام العمل">
            <button
              role="tab"
              aria-selected={tab === "workspace"}
              className={tab === "workspace" ? "active" : ""}
              onClick={() => setTab("workspace")}
            >
              مساحة العمل
            </button>
            <button
              role="tab"
              aria-selected={tab === "inventory"}
              className={tab === "inventory" ? "active" : ""}
              onClick={() => setTab("inventory")}
            >
              مخزون الخانات
            </button>
            <button
              role="tab"
              aria-selected={tab === "build"}
              className={tab === "build" ? "active" : ""}
              onClick={() => setTab("build")}
            >
              البناء والمعاينة
            </button>
            <button
              role="tab"
              aria-selected={tab === "engine"}
              className={tab === "engine" ? "active" : ""}
              onClick={() => setTab("engine")}
            >
              المحرك والاختبار الرأسي
            </button>
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
                <h2>مساحة عمل الخط</h2>
                <p className="hint">
                  افتح مشروعاً واستورد رسماً لحرف ما ليظهر هنا مع المساطر وخطوط القياس
                  والأدلة والشبكة والالتقاط الذكي.
                </p>
              </div>
            )
          ) : tab === "inventory" ? (
            project ? (
              <InventoryPanel project={project} onProject={setProject} onNotice={showNotice} />
            ) : (
              <div className="panel empty-workspace">
                <h2>ابدأ بإنشاء مشروع</h2>
                <p className="hint">
                  أنشئ مشروعاً جديداً أو افتح مشروعاً موجوداً بصيغة <code>.afsp</code> لتوليد
                  مخزون الخانات واستيراد رسومات SVG لكل خانة على حدة.
                </p>
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

      <footer className="footer-bar">
        <span>التشكيل وبناء OTF/TTF: مكتمل</span>
        <span>المعاينة والجودة: مكتملة</span>
      </footer>
    </div>
  );
}
