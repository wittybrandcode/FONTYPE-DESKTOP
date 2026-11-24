import { useEffect, useState, type FormEvent } from "react";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../core/api";
import type { ProjectHandle } from "../core/types";
import { Icon } from "./icons";
import { useFocusTrap } from "./components";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (handle: ProjectHandle) => void;
  onNotice: (text: string, kind?: "ok" | "error") => void;
}

/** Small modal for the first-run "new project" flow. */
export default function ProjectDialog({ open, onClose, onCreated, onNotice }: Props) {
  const [name, setName] = useState("");
  const [family, setFamily] = useState("");
  const [style, setStyle] = useState("Regular");
  const [upm, setUpm] = useState(1000);
  const [busy, setBusy] = useState(false);
  const trapRef = useFocusTrap(open);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const parent = await openFolderDialog({
        directory: true,
        multiple: false,
        title: "اختر المجلد الذي سيحتوي المشروع",
      });
      if (typeof parent !== "string") return;
      const handle = await api.createProject({
        parent,
        name: name.trim(),
        family: family.trim() || name.trim(),
        style: style.trim() || "Regular",
        upm,
      });
      onCreated(handle);
      onNotice("تم إنشاء المشروع وحفظه بصيغة .afsp", "ok");
      onClose();
    } catch (error) {
      onNotice(String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div
        ref={trapRef}
        className="modal-card project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <span className="modal-icon"><Icon name="folderOpen" size={20} /></span>
          <div>
            <h2 id="new-project-title">مشروع جديد</h2>
            <p className="hint">سيُنشأ مجلد مشروع محلي بصيغة .afsp مع مخزون الخانات.</p>
          </div>
          <button type="button" className="icon-btn has-tip" data-tip="إغلاق" aria-label="إغلاق" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </header>

        <form onSubmit={(event) => void submit(event)}>
          <div className="form-stack">
            <label htmlFor="np-name">اسم المشروع</label>
            <input id="np-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="مثال: خط الربيع" required />

            <label htmlFor="np-family">اسم العائلة</label>
            <input id="np-family" value={family} onChange={(event) => setFamily(event.target.value)} placeholder="Arabic Spring" dir="ltr" />

            <div className="form-row">
              <div>
                <label htmlFor="np-style">النمط</label>
                <input id="np-style" value={style} onChange={(event) => setStyle(event.target.value)} dir="ltr" />
              </div>
              <div>
                <label htmlFor="np-upm">وحدات لكل Em</label>
                <select id="np-upm" value={upm} onChange={(event) => setUpm(Number(event.target.value))}>
                  <option value={1000}>1000</option>
                  <option value={2048}>2048</option>
                </select>
              </div>
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" onClick={onClose}>إلغاء</button>
            <button type="submit" className="primary" disabled={busy || !name.trim()}>
              {busy ? "جارٍ الإنشاء…" : "إنشاء المشروع"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
